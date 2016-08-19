'use strict';

const	async	= require('async'),
	db	= require('larvitdb');

exports = module.exports = function(cb) {
	const tasks = [];

	tasks.push(function(cb) {
		db.query('ALTER TABLE bloj CHANGE nisse hasse int(11);', cb);
	});

	tasks.push(function(cb) {
		db.query('INSERT INTO bloj (hasse) VALUES(42);', cb);
	});

	async.series(tasks, cb);
};
