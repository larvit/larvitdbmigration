'use strict';

var mysql = require('mysql'),
    async = require('async'),
    log   = require('winston'),
    fs    = require('fs'),
    _     = require('lodash');

exports = module.exports = function(options) {
	options = options || {};

	_.assign(options, {
		'tableName': 'db_version',
		'migrationScriptsPath': './dbmigration'
	});

	log.verbose('larvitdbmigration: Started with tableName: ' + options.tableName + ' and migrationScriptsPath: ' + options.migrationScriptsPath);

	// Resolve ./ paths to be relative to application path
	if (options.migrationScriptsPath.substring(0, 2) === './') {
		options.migrationScriptsPath = process.cwd() + '/' + options.migrationScriptsPath.substring(2);
	}

	// We need to use a new connection to be sure it is not dropped on heavy migration scripts
	return function(cb) {
		var dbCon = mysql.createConnection(options),
		    tasks = [],
		    curVer;

		dbCon.connect();

		function runScripts(startVersion, cb) {
			log.verbose('larvitdbmigration: runScripts() - Started with startVersion: "' + startVersion + '"');
			fs.readdir(options.migrationScriptsPath, function(err, items) {
				var i;

				if (err) {
					log.warn('larvitdbmigration: runScripts() - Could not read migration script path "' + options.migrationScriptsPath + '"');
					cb();
					return;
				}

				i = 0;
				while (items[i] !== undefined) {
					if (items[i] === startVersion + '.js') {
						log.info('larvitdbmigration: runScripts() - Found migration script #' + startVersion + ', running it now.');
						require(options.migrationScriptsPath + '/' + startVersion + '.js')(function(err) {
							var sql = 'UPDATE `' + options.tableName + '` SET version = ' + parseInt(startVersion) + ';';

							if (err) {
								log.error('larvitdbmigration: runScripts() - Got error running migration script #' + startVersion + ': ' + err.message);
								cb(err);
								return;
							}

							log.info('larvitdbmigration: runScripts() - Migration script #' + startVersion + ' ran. Update database and move on.');
							log.debug('larvitdbmigration: runScripts() - Running SQL: "' + sql + '"');
							dbCon.query(sql, function(err) {
								if (err) {
									cb(err);
									return;
								}

								runScripts(parseInt(startVersion) + 1, cb);
							});
						});

						return;
					}

					i ++;
				}

				// If we end up here, it means there are no more migration scripts to run
				cb();
			});
		}

		// Create table if it does not exist
		tasks.push(function(cb) {
			var sql = 'SHOW TABLES like \'' + options.tableName + '\';';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			dbCon.query(sql, function(err, rows) {
				var customErr;

				if (err) {
					cb(err);
					return;
				}

				if (rows.length === 1) {
					cb();
				} else if (rows.length === 0) {
					sql = 'CREATE TABLE `' + options.tableName + '` (`version` int unsigned NOT NULL DEFAULT \'0\') ENGINE=\'InnoDB\' COLLATE \'ascii_bin\';';
					log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
					dbCon.query(sql, cb);
				} else {
					customErr = new Error('larvitdbmigration: SHOW TABLES like \'' + options.tableName + '\'; returned either 0 or 1 rows, but: "' + rows.length + '"');
					log.error(customErr.message);
					cb(customErr);
				}
			});
		});

		// Lock table
		tasks.push(function(cb) {
			var sql = 'LOCK TABLES `' + options.tableName + '` WRITE;';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			dbCon.query(sql, cb);
		});

		// Insert first row if it does not exist
		tasks.push(function(cb) {
			var sql = 'SELECT version FROM `' + options.tableName + '`;';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			dbCon.query(sql, function(err, rows) {
				if (err) {
					cb(err);
					return;
				}

				if (rows.length === 0) {
					curVer = '0';
					sql = 'INSERT INTO `' + options.tableName + '` (version) VALUES(0);';
					log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
					dbCon.query(sql, cb);

					return;
				} else {
					curVer = rows[0].version;
				}

				cb();
			});
		});

		// Run scripts
		tasks.push(function(cb) {
			runScripts(parseInt(curVer) + 1, cb);
		});

		// Unlock table
		tasks.push(function(cb) {
			var sql = 'UNLOCK TABLES;';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			dbCon.query(sql, cb);
		});

		async.series(tasks, function(err) {
			dbCon.end();

			cb(err);
		});
	};
};