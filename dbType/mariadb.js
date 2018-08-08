'use strict';

const	topLogPrefix	= 'larvitdbmigration: dbType/mariadb.js: ',
	async	= require('async'),
	mysql	= require('mysql2'),
	fs	= require('fs'),
	_	= require('lodash');

function Driver(options) {
	const	that	= this;

	that.options	= options || {};

	if ( ! that.options.tableName) {
		throw new Error('Missing required option "tableName"');
	}

	if ( ! that.options.dbDriver) {
		throw new Error('Missing option dbDriver');
	}
}

Driver.prototype.getLock = function getLock(cb) {
	const	logPrefix	= topLogPrefix + 'getLock() - tableName: "' + this.options.tableName + '" - ',
		tableName	= this.options.tableName,
		that	= this,
		db	= that.options.dbDriver;

	try {
		const	tasks	= [];

		let	dbCon;

		tasks.push(function (cb) {
			db.pool.getConnection(function (err, res) {
				if (err) {
					that.log.error(logPrefix + 'getConnection() err: ' + err.message);
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
					that.log.error(logPrefix + 'SQL err: ' + err.message);
					return cb(err);
				}

				if (rows.length === 0) {
					const err = 'No database records';

					that.log.error(logPrefix + err.message);
					return cb(err);
				}

				if (rows[0].running === 0) {
					cb();
				} else {
					dbCon.query('UNLOCK TABLES;', function (err) {
						if (err) {
							that.log.error(logPrefix + 'SQL err: ' + err.message);
							return cb(err);
						}

						that.log.info(logPrefix + 'Another process is running the migrations, wait and try again soon.');
						setTimeout(function () {
							that.getLock(cb);
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
		that.log.error(logPrefix + 'Error from driver: ' + err.message);
		cb(err);
	}
};

Driver.prototype.run = function run(cb) {
	const	logPrefix	= topLogPrefix + 'run() - tableName: "' + this.options.tableName + '" - ',
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

			that.log.info(logPrefix + 'Current database version is ' + curVer);

			cb();
		});
	});

	// Run scripts
	tasks.push(function (cb) {
		try {
			that.runScripts(curVer + 1, cb);
		} catch (err) {
			that.log.error(logPrefix + 'Error from driver: ' + err.message);
			cb(err);
		}
	});

	// Unlock table
	tasks.push(function (cb) {
		db.query('UPDATE `' + tableName + '` SET running = 0;', cb);
	});

	async.series(tasks, cb);
};

Driver.prototype.runScripts = function runScripts(startVersion, cb) {
	const	migrationScriptsPath	= this.options.migrationScriptsPath,
		tableName	= this.options.tableName,
		logPrefix	= topLogPrefix + 'runScripts() - tableName: "' + this.options.tableName + '" - ',
		that	= this,
		db	= this.options.dbDriver;

	that.log.verbose(logPrefix + 'Started with startVersion: "' + startVersion + '" in path: "' + migrationScriptsPath + '"');

	try {
		fs.readdir(migrationScriptsPath, function (err, items) {
			const sql = 'UPDATE `' + tableName + '` SET version = ' + parseInt(startVersion) + ';';

			let	localDbConf;

			if (err) {
				that.log.info(logPrefix + 'Could not read migration script path "' + migrationScriptsPath + '"');
				return cb();
			}

			for (let i = 0; items[i] !== undefined; i ++) {
				if (items[i] === startVersion + '.js') {
					that.log.info(logPrefix + 'Found js migration script #' + startVersion + ', running it now.');
					require(migrationScriptsPath + '/' + startVersion + '.js').apply(that, [function (err) {
						if (err) {
							that.log.error(logPrefix + 'Got error running migration script ' + migrationScriptsPath + '/' + startVersion + '.js' + ': ' + err.message);
							return cb(err);
						}

						that.log.debug(logPrefix + 'Js migration script #' + startVersion + ' ran. Updating database version and moving on.');
						db.query(sql, function (err) {
							if (err) return cb(err);

							that.runScripts(parseInt(startVersion) + 1, cb);
						});
					}]);

					return;
				} else if (items[i] === startVersion + '.sql') {
					let	dbCon;

					that.log.info(logPrefix + 'Found sql migration script #' + startVersion + ', running it now.');

					localDbConf	= _.cloneDeep(db.conf);
					localDbConf.multipleStatements	= true;
					dbCon	= mysql.createConnection(localDbConf);

					dbCon.query(fs.readFileSync(migrationScriptsPath + '/' + items[i]).toString(), function (err) {
						if (err) {
							that.log.error(logPrefix + 'Migration file: ' + items[i] + ' SQL error: ' + err.message);
							return cb(err);
						}

						that.log.info(logPrefix + 'Sql migration script #' + startVersion + ' ran. Updating database version and moving on.');
						db.query(sql, function (err) {
							if (err) return cb(err);

							dbCon.end();

							that.runScripts(parseInt(startVersion) + 1, cb);
						});
					});

					return;
				}
			}

			that.log.info(logPrefix + 'Database migrated and done. Final version is ' + (startVersion - 1));

			// If we end up here, it means there are no more migration scripts to run
			cb();
		});
	} catch (err) {
		that.log.error(logPrefix + 'Uncaught error: ' + err.message);
		cb(err);
	}
};

exports = module.exports = Driver;
