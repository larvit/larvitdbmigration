'use strict';

const	async	= require('async'),
	db	= require('larvitdb');

exports = module.exports = function(cb) {
	const tasks = [];

	tasks.push(function(cb) {
		db.query('DROP FUNCTION IF EXISTS multi_three;', cb);
	});

	tasks.push(function(cb) {
		db.query(`CREATE FUNCTION multi_three (x INT) RETURNS INT
DETERMINISTIC
BEGIN
	SET @a=1;
	SET @b=2;
	RETURN (@a + @b) * x;
END
`, cb);
	});

	async.series(tasks, cb);
};
