'use strict';

const	async	= require('async'),
	mysql	= require('mysql2'),
	log	= require('winston'),
	fs	= require('fs'),
	db	= require('larvitdb'),
	_	= require('lodash');

exports = module.exports = function(options) {
	options = options || {};

	if (options.tableName	=== undefined) options.tableName	= 'db_version';
	if (options.migrationScriptsPath	=== undefined) options.migrationScriptsPath	= './dbmigration';

	log.verbose('larvitdbmigration: Started with options: ' + JSON.stringify(options));

	// Resolve ./ paths to be relative to application path
	if (options.migrationScriptsPath.substring(0, 2) === './') {
		options.migrationScriptsPath = process.cwd() + '/' + options.migrationScriptsPath.substring(2);
	}

	function getLock(cb) {
		try {
			const	tasks	= [];

			let dbCon;

			tasks.push(function(cb) {
				db.pool.getConnection(function(err, res) {
					if (err) {
						log.error('larvitdbmigration: getLock() - getConnection() err: ' + err.message);
					}

					dbCon = res;
					cb(err);
				});
			});

			tasks.push(function(cb) {
				dbCon.query('LOCK TABLES `' + options.tableName + '` WRITE;', cb);
			});

			tasks.push(function(cb) {
				dbCon.query('SELECT running FROM `' + options.tableName + '`', function(err, rows) {
					if (err) {
						log.error('larvitdbmigration: getLock() - SQL err: ' + err.message);
						cb(err);
						return;
					}

					if (rows.length === 0) {
						const err = 'No database records in ' + options.tableName;

						log.error('larvitdbmigration: getLock() - ' + err.message);
						cb(err);
						return;
					}

					if (rows[0].running === 0) {
						cb();
					} else {
						dbCon.query('UNLOCK TABLES;', function(err) {
							if (err) {
								log.error('larvitdbmigration: getLock() - SQL err: ' + err.message);
								cb(err);
								return;
							}

							log.info('larvitdbmigration: getLock() - Another process is running the migrations for table ' + options.tableName + ', wait and try again soon.');
							setTimeout(function() {
								getLock(cb);
							}, 500);
						});
					}
				});
			});

			tasks.push(function(cb) {
				dbCon.query('UPDATE `' + options.tableName + '` SET running = 1', cb);
			});

			tasks.push(function(cb) {
				dbCon.query('UNLOCK TABLES;', cb);
			});

			tasks.push(function(cb) {
				dbCon.release();
				cb();
			});

			async.series(tasks, cb);
		} catch(err) {
			log.error('larvitdbmigration: getLock() - Error from driver: ' + err.message);
			cb(err);
		}
	}

	return function(cb) {
		const tasks = [];

		let curVer;

		function runScripts(startVersion, cb) {
			log.verbose('larvitdbmigration: runScripts() - Started with startVersion: "' + startVersion + '" in path: "' + options.migrationScriptsPath + '" for table ' + options.tableName);

			try {
				fs.readdir(options.migrationScriptsPath, function(err, items) {
					const sql = 'UPDATE `' + options.tableName + '` SET version = ' + parseInt(startVersion) + ';';

					let localDbConf;

					if (err) {
						log.info('larvitdbmigration: runScripts() - Could not read migration script path "' + options.migrationScriptsPath + '"');
						cb();
						return;
					}

					for (let i = 0; items[i] !== undefined; i ++) {
						if (items[i] === startVersion + '.js') {
							log.info('larvitdbmigration: runScripts() - Found js migration script #' + startVersion + ' for table ' + options.tableName + ', running it now.');
							require(options.migrationScriptsPath + '/' + startVersion + '.js')(function(err) {
								if (err) {
									log.error('larvitdbmigration: runScripts() - Got error running migration script ' + options.migrationScriptsPath + '/' + startVersion + '.js' + ': ' + err.message);
									cb(err);
									return;
								}

								log.debug('larvitdbmigration: runScripts() - Js migration script #' + startVersion + ' for table ' + options.tableName + ' ran. Updating database version and moving on.');
								db.query(sql, function(err) {
									if (err) { cb(err); return; }

									runScripts(parseInt(startVersion) + 1, cb);
								});
							});

							return;
						} else if (items[i] === startVersion + '.sql') {
							let dbCon;

							log.info('larvitdbmigration: runScripts() - Found sql migration script #' + startVersion + ' for table ' + options.tableName + ', running it now.');

							localDbConf	= _.cloneDeep(db.conf);
							localDbConf.multipleStatements	= true;
							dbCon	= mysql.createConnection(localDbConf);

							dbCon.query(fs.readFileSync(options.migrationScriptsPath + '/' + items[i]).toString(), function(err) {
								if (err) {
									log.error('larvitdbmigration: Migration file: ' + items[i] + ' SQL error: ' + err.message);
									cb(err);
									return;
								}

								log.info('larvitdbmigration: runScripts() - Sql migration script #' + startVersion + ' for table ' + options.tableName + ' ran. Updating database version and moving on.');
								db.query(sql, function(err) {
									if (err) { cb(err); return; }

									dbCon.end();

									runScripts(parseInt(startVersion) + 1, cb);
								});
							});

							return;
						}
					}

					log.info('larvitdbmigration: runScripts() - Database migrated and done. Final version is ' + (startVersion - 1) + ' in table ' + options.tableName);

					// If we end up here, it means there are no more migration scripts to run
					cb();
				});
			} catch(err) {
				log.error('larvitdbmigration: runScripts() - Uncaught error: ' + err.message);
				cb(err);
			}
		}

		// Create table if it does not exist
		tasks.push(function(cb) {
			const sql = 'CREATE TABLE IF NOT EXISTS `' + options.tableName + '` (`id` tinyint(1) unsigned NOT NULL DEFAULT \'1\', `version` int(10) unsigned NOT NULL DEFAULT \'0\', `running` tinyint(3) unsigned NOT NULL DEFAULT \'0\', PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin COMMENT=\'Used for automatic database versioning. Do not modify!\';';
			db.query(sql, cb);
		});

		// Update old version of table (for seamless updating of old versions of this module)
		tasks.push(function(cb) {
			db.query('DESCRIBE `' + options.tableName + '`', function(err, rows) {
				if (err) { cb(err); return; }

				if (rows.length === 2 && rows[0].Field === 'version' && rows[1].Field === 'running') {
					// Old version detected! Update!
					db.query('ALTER TABLE `' + options.tableName + '` ADD `id` tinyint(1) unsigned NOT NULL DEFAULT \'1\' FIRST;', function(err) {
						if (err) { cb(err); return; }

						db.query('ALTER TABLE `' + options.tableName + '` ADD PRIMARY KEY `id` (`id`);', cb);
					});
				} else {
					// Nothing to do, continue
					cb();
				}
			});
		});

		// Insert first record if it does not exist
		tasks.push(function(cb) {
			db.query('INSERT IGNORE INTO `' + options.tableName + '` VALUES(1, 0, 0);', cb);
		});

		// Lock table by setting the running column to 1
		tasks.push(getLock);

		// Get current version
		tasks.push(function(cb) {
			db.query('SELECT version FROM `' + options.tableName + '`;', function(err, rows) {
				if (err) { cb(err); return; }

				curVer = parseInt(rows[0].version);

				log.info('larvitdbmigration: Current database version for table ' + options.tableName + ' is ' + curVer);

				cb();
			});
		});

		// Run scripts
		tasks.push(function(cb) {
			try {
				runScripts(curVer + 1, cb);
			} catch(err) {
				log.error('larvitdbmigration: Error from driver: ' + err.message);
				cb(err);
			}
		});

		// Unlock table
		tasks.push(function(cb) {
			db.query('UPDATE `' + options.tableName + '` SET running = 0;', cb);
		});

		async.series(tasks, cb);
	};
};
