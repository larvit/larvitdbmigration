'use strict';

var async = require('async'),
    log   = require('winston'),
    fs    = require('fs'),
    db    = require('larvitdb');

exports = module.exports = function(options) {
	options = options || {};

	if (options.tableName            === undefined) options.tableName            = 'db_version';
	if (options.migrationScriptsPath === undefined) options.migrationScriptsPath = './dbmigration';

	log.verbose('larvitdbmigration: Started with options: ' + JSON.stringify(options));

	// Resolve ./ paths to be relative to application path
	if (options.migrationScriptsPath.substring(0, 2) === './') {
		options.migrationScriptsPath = process.cwd() + '/' + options.migrationScriptsPath.substring(2);
	}

	function getLock(cb) {
		db.query('SELECT running FROM `' + options.tableName + '`;', function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (parseInt(rows[0].running) === 1) {
				log.verbose('larvitdbmigration: Another process is running the migrations, wait and try again soon.');
				setTimeout(function() {
					getLock(cb);
				}, 500);
			} else {
				cb();
			}
		});
	}

	return function(cb) {
		var tasks = [],
		    curVer;

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

							log.info('larvitdbmigration: runScripts() - Migration script #' + startVersion + ' ran. Update database version and move on.');
							log.debug('larvitdbmigration: runScripts() - Running SQL: "' + sql + '"');
							db.query(sql, function(err) {
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
			var sql = 'CREATE TABLE IF NOT EXISTS `' + options.tableName + '` (`version` int(10) unsigned NOT NULL DEFAULT \'0\', `running` tinyint(3) unsigned NOT NULL DEFAULT \'0\') ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin COMMENT \'Used for automatic database versioning. Do not modify!\';';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			db.query(sql, cb);
		});

		// Insert first record if it does not exist
		tasks.push(function(cb) {
			var sql = 'SELECT * FROM `' + options.tableName + '`;';

			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			db.query(sql, function(err, rows) {
				var sql = 'INSERT INTO `' + options.tableName + '` (version, running) VALUES(0, 0);';

				if (err) {
					cb(err);
					return;
				}

				if ( ! rows.length) {
					log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
					db.query(sql, cb);
				} else {
					cb();
				}
			});
		});

		// Lock table by setting the running column to 1
		tasks.push(function(cb) {
			getLock(function(err) {
				var sql = 'UPDATE `' + options.tableName + '` SET running = 1;';

				if (err) {
					cb(err);
					return;
				}

				log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
				db.query(sql, cb);
			});
		});

		// Get current version
		tasks.push(function(cb) {
			var sql = 'SELECT version FROM `' + options.tableName + '`;';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			db.query(sql, function(err, rows) {
				if (err) {
					cb(err);
					return;
				}

				curVer = parseInt(rows[0].version);

				cb();
			});
		});

		// Run scripts
		tasks.push(function(cb) {
			runScripts(curVer + 1, cb);
		});

		// Unlock table
		tasks.push(function(cb) {
			var sql = 'UPDATE `' + options.tableName + '` SET running = 0;';
			log.debug('larvitdbmigration: Running SQL: "' + sql + '"');
			db.query(sql, cb);
		});

		async.series(tasks, cb);
	};
};