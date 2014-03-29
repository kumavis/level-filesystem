var path = require('path');
var concat = require('concat-stream');
var once = require('once');
var stat = require('./stat');
var errno = require('./errno');

var ROOT = stat({
	type: 'directory',
	mode: 0777,
	size: 4096
});

var normalize = function(key) {
	key = key[0] === '/' ? key : '/' + key;
	key = path.normalize(key);
	if (key === '/') return key;
	return key[key.length-1] === '/' ? key.slice(0, -1) : key;
};

var prefix = function(key) {
	var depth = key.split('/').length.toString(36);
	return '0000000000'.slice(depth.length)+depth+key;
};

var noop = function() {};

module.exports = function(db) {
	var that = {};

	var get = function(key, cb) {
		if (key === '/') return cb(null, ROOT);
		db.get(prefix(key), function(err, doc) {
			if (err && err.notFound) return cb(errno.ENOENT(key));
			if (err) return cb(err);
			cb(null, doc && stat(doc));
		});
	};

	var put = function(key, val, cb) {
		if (key === '/') return cb(errno.EPERM(key));
		db.put(prefix(key), stat(val), cb);
	};

	var del = function(key, cb) {
		if (key === '/') return cb(errno.EPERM(key));
		db.del(prefix(key), cb);
	};

	var checkParent = function(key, cb) {
		get(path.dirname(key), function(err, entry) {
			if (err) return cb(err);
			if (!entry.isDirectory()) return cb(errno.ENOTDIR(key));
			cb();
		});
	};

	that.mkdir = function(key, mode, cb) {
		if (typeof mode === 'function') return that.mkdir(key, null, mode);
		if (!mode) mode = 0777;
		if (!cb) cb = noop;
		key = normalize(key);

		checkParent(key, function(err) {
			if (err) return cb(err);

			get(key, function(err, entry) {
				if (err && err.code !== 'ENOENT') return cb(err);
				if (entry) return cb(errno.EEXIST(key));

				put(key, stat({
					type:'directory',
					mode: mode,
					size: 4096
				}), cb);
			});
		});
	};

	that.rmdir = function(key, cb) {
		if (!cb) cb = noop;
		key = normalize(key);

		that.readdir(key, function(err, files) {
			if (err) return cb(err);
			if (files.length) return cb(errno.ENOTEMPTY(key));
			del(key, cb);
		});
	};

	that.readdir = function(key, cb) {
		key = normalize(key);

		checkParent(key, function(err) {
			if (err) return cb(err);

			get(key, function(err, entry) {
				if (err) return cb(err);
				if (!entry) return cb(errno.ENOENT(key));
				if (!entry.isDirectory()) return cb(errno.ENOTDIR(key));

				var start = prefix(key === '/' ? key : key + '/');
				var keys = db.createKeyStream({start: start, end: start+'\xff'});

				cb = once(cb);

				keys.on('error', cb);
				keys.pipe(concat({encoding:'object'}, function(files) {
					files = files.map(function(file) {
						return file.split('/').pop();
					});

					cb(null, files);
				}));
			});
		});
	};

	that.stat = function(key, cb) {
		get(normalize(key), cb);
	};

	that.exists = function(key, cb) {
		that.stat(key, function(err) {
			cb(!err);
		});
	};

	return that;
};