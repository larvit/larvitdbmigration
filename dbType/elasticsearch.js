'use strict';

const	topLogPrefix	= 'larvitdbmigration: dbType/elasticsearch.js - ',
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs'),
	_	= require('lodash');

function getLock(cb) {
	const	logPrefix	= topLogPrefix + 'getLock() - ',
		tableName	= this.options.tableName,
		that	= this,
		es	= that.options.dbDriver;

	try {
		const	tasks	= [];

		let	dbCon;

		tasks.push(function (cb) {
			db.pool.getConnection(function (err, res) {
				if (err) {
					log.error(logPrefix + 'getConnection() err: ' + err.message);
				}

				dbCon	= res;
				cb(err);
			});
		});

		tasks.push(function (cb) {
			dbCon.query('LOCK TABLES `' + tableName + '` WRITE;', cb);
		});

		tasks.push(function (cb) {
			dbCon.query('SELECT running FROM `' + tableName + '`', function (err, rows) {
				if (err) {
					log.error(logPrefix + 'SQL err: ' + err.message);
					return cb(err);
				}

				if (rows.length === 0) {
					const err = 'No database records in ' + tableName;

					log.error(logPrefix + err.message);
					return cb(err);
				}

				if (rows[0].running === 0) {
					cb();
				} else {
					dbCon.query('UNLOCK TABLES;', function (err) {
						if (err) {
							log.error(logPrefix + 'SQL err: ' + err.message);
							return cb(err);
						}

						log.info(logPrefix + 'Another process is running the migrations for table ' + tableName + ', wait and try again soon.');
						setTimeout(function () {
							getLock(cb);
						}, 500);
					});
				}
			});
		});

		tasks.push(function (cb) {
			dbCon.query('UPDATE `' + tableName + '` SET running = 1', cb);
		});

		tasks.push(function (cb) {
			dbCon.query('UNLOCK TABLES;', cb);
		});

		tasks.push(function (cb) {
			dbCon.release();
			cb();
		});

		async.series(tasks, cb);
	} catch (err) {
		log.error(logPrefix + 'Error from driver: ' + err.message);
		cb(err);
	}
}

function run(cb) {
	const	logPrefix	= topLogPrefix + 'run() - ',
		tableName	= this.options.tableName,
		tasks	= [],
		that	= this,
		db	= this.options.dbDriver;

	let	curVer;

	// Create table if it does not exist
	tasks.push(function (cb) {
		const sql = 'CREATE TABLE IF NOT EXISTS `' + tableName + '` (`id` tinyint(1) unsigned NOT NULL DEFAULT \'1\', `version` int(10) unsigned NOT NULL DEFAULT \'0\', `running` tinyint(3) unsigned NOT NULL DEFAULT \'0\', PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin COMMENT=\'Used for automatic database versioning. Do not modify!\';';
		db.query(sql, cb);
	});

	// Update old version of table (for seamless updating of old versions of this module)
	tasks.push(function (cb) {
		db.query('DESCRIBE `' + tableName + '`', function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 2 && rows[0].Field === 'version' && rows[1].Field === 'running') {
				// Old version detected! Update!
				db.query('ALTER TABLE `' + tableName + '` ADD `id` tinyint(1) unsigned NOT NULL DEFAULT \'1\' FIRST;', function (err) {
					if (err) return cb(err);

					db.query('ALTER TABLE `' + tableName + '` ADD PRIMARY KEY `id` (`id`);', cb);
				});
			} else {
				// Nothing to do, continue
				cb();
			}
		});
	});

	// Insert first record if it does not exist
	tasks.push(function (cb) {
		db.query('INSERT IGNORE INTO `' + tableName + '` VALUES(1, 0, 0);', cb);
	});

	// Lock table by setting the running column to 1
	tasks.push(function (cb) {
		that.getLock(cb);
	});

	// Get current version
	tasks.push(function (cb) {
		db.query('SELECT version FROM `' + tableName + '`;', function (err, rows) {
			if (err) return cb(err);

			curVer = parseInt(rows[0].version);

			log.info(logPrefix + 'Current database version for table ' + tableName + ' is ' + curVer);

			cb();
		});
	});

	// Run scripts
	tasks.push(function (cb) {
		try {
			that.runScripts(curVer + 1, cb);
		} catch (err) {
			log.error(logPrefix + 'Error from driver: ' + err.message);
			cb(err);
		}
	});

	// Unlock table
	tasks.push(function (cb) {
		db.query('UPDATE `' + tableName + '` SET running = 0;', cb);
	});

	async.series(tasks, cb);
};

function runScripts(startVersion, cb) {
	const	migrationScriptsPath	= this.options.migrationScriptsPath,
		tableName	= this.options.tableName,
		logPrefix	= topLogPrefix + 'runScripts() - ',
		that	= this,
		db	= this.options.dbDriver;

	log.verbose(logPrefix + 'Started with startVersion: "' + startVersion + '" in path: "' + migrationScriptsPath + '" for table ' + tableName);

	try {
		fs.readdir(migrationScriptsPath, function (err, items) {
			const sql = 'UPDATE `' + tableName + '` SET version = ' + parseInt(startVersion) + ';';

			let	localDbConf;

			if (err) {
				log.info(logPrefix + 'Could not read migration script path "' + migrationScriptsPath + '"');
				return cb();
			}

			for (let i = 0; items[i] !== undefined; i ++) {
				if (items[i] === startVersion + '.js') {
					log.info(logPrefix + 'Found js migration script #' + startVersion + ' for table ' + tableName + ', running it now.');
					require(migrationScriptsPath + '/' + startVersion + '.js')(function (err) {
						if (err) {
							log.error(logPrefix + 'Got error running migration script ' + migrationScriptsPath + '/' + startVersion + '.js' + ': ' + err.message);
							return cb(err);
						}

						log.debug(logPrefix + 'Js migration script #' + startVersion + ' for table ' + tableName + ' ran. Updating database version and moving on.');
						db.query(sql, function (err) {
							if (err) return cb(err);

							that.runScripts(parseInt(startVersion) + 1, cb);
						});
					});

					return;
				} else if (items[i] === startVersion + '.sql') {
					let	dbCon;

					log.info(logPrefix + 'Found sql migration script #' + startVersion + ' for table ' + tableName + ', running it now.');

					localDbConf	= _.cloneDeep(db.conf);
					localDbConf.multipleStatements	= true;
					dbCon	= mysql.createConnection(localDbConf);

					dbCon.query(fs.readFileSync(migrationScriptsPath + '/' + items[i]).toString(), function (err) {
						if (err) {
							log.error(logPrefix + 'Migration file: ' + items[i] + ' SQL error: ' + err.message);
							return cb(err);
						}

						log.info(logPrefix + 'Sql migration script #' + startVersion + ' for table ' + tableName + ' ran. Updating database version and moving on.');
						db.query(sql, function (err) {
							if (err) return cb(err);

							dbCon.end();

							that.runScripts(parseInt(startVersion) + 1, cb);
						});
					});

					return;
				}
			}

			log.info(logPrefix + 'Database migrated and done. Final version is ' + (startVersion - 1) + ' in table ' + tableName);

			// If we end up here, it means there are no more migration scripts to run
			cb();
		});
	} catch (err) {
		log.error(logPrefix + 'Uncaught error: ' + err.message);
		cb(err);
	}
}

exports.getLock	= getLock;
exports.run	= run;
exports.runScripts	= runScripts;
