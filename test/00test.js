'use strict';

const	elasticsearch	= require('elasticsearch'),
	DbMigration	= require(__dirname + '/../index.js'),
	request	= require('request'),
	assert	= require('assert'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	path	= require('path'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

let	mariaDbConf,
	esConf,
	es;

// Set up winston
log.remove(log.transports.Console);
log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});

before(function (done) {
	const	tasks	= [];

	let	mariaDbConfFile,
		esConfFile;

	if (process.env.ESCONFFILE === undefined) {
		esConfFile = __dirname + '/../config/es_test.json';
	} else {
		esConfFile = process.env.ESCONFFILE;
	}

	if (process.env.DBCONFFILE === undefined) {
		mariaDbConfFile = __dirname + '/../config/db_test.json';
	} else {
		mariaDbConfFile = process.env.DBCONFFILE;
	}

	log.verbose('MariaDB config file: "' + mariaDbConfFile + '"');
	log.verbose('Elasticsearch config file: "' + esConfFile + '"');

	// MariaDb
	tasks.push(function (cb) {
		function checkEmptyMariaDb() {
			db.query('SHOW TABLES', function (err, rows) {
				if (err) {
					log.error(err);
					process.exit(1);
				}

				if (rows.length) {
					log.error('Database is not empty. To make a test, you must supply an empty database!');
					process.exit(1);
				}

				cb();
			});
		}

		function runMariaDbSetup(mariaDbConfFile) {
			log.verbose('DB config: ' + JSON.stringify(require(mariaDbConfFile)));

			db.setup(require(mariaDbConfFile), function (err) {
				if (err) {
					log.error('Database setup problem: ' + err.message);
					process.exit(1);
				}

				checkEmptyMariaDb();
			});
		}

		fs.stat(mariaDbConfFile, function (err) {
			const	altMariaDbConfFile	= __dirname + '/../config/' + mariaDbConfFile;

			if (err) {
				log.info('Failed to find config file "' + mariaDbConfFile + '", retrying with "' + altMariaDbConfFile + '"');

				fs.stat(altMariaDbConfFile, function (err) {
					if (err) {
						log.error('MariaDb config file does not exist');
						process.exit(1);
					}

					mariaDbConf = require(altMariaDbConfFile);
					runMariaDbSetup(altMariaDbConfFile);
				});
			} else {
				mariaDbConf	= require(mariaDbConfFile);
				runMariaDbSetup(mariaDbConfFile);
			}
		});
	});

	// Elasticsearch
	tasks.push(function (cb) {
		function checkEmptyEs() {
			es.cat.indices({'v': true}, function (err, result) {
				if (err) throw err;

				// Source: https://www.elastic.co/guide/en/elasticsearch/reference/1.4/_list_all_indexes.html
				if (result !== 'health status index uuid pri rep docs.count docs.deleted store.size pri.store.size\n') {
					throw new Error('Database is not empty. To make a test, you must supply an empty database!');
					process.exit(1);
				}

				cb(err);
			});
		}

		function runEsSetup(esConfFile) {
			log.verbose('ES config: ' + JSON.stringify(require(esConfFile)));

			es = lUtils.instances.elasticsearch = new elasticsearch.Client(require(esConfFile).clientOptions);
			es.ping(function (err) {
				if (err) {
					log.error(err.message);
					process.exit(1);
				}

				checkEmptyEs();
			});
		}

		fs.stat(esConfFile, function (err) {
			const	altEsConfFile	= __dirname + '/../config/' + esConfFile;

			if (err) {
				log.info('Failed to find config file "' + esConfFile + '", retrying with "' + altEsConfFile + '"');

				fs.stat(altEsConfFile, function (err) {
					if (err) {
						log.error('ES config file does not exist');
						process.exit(1);
					}

					esConf = require(altEsConfFile);
					runEsSetup(altEsConfFile);
				});
			} else {
				esConf = require(esConfFile);
				runEsSetup(esConfFile);
			}
		});
	});

	async.parallel(tasks, done);
});

after(function (done) {
	const	tasks	= [];

	tasks.push(function (cb) {
		db.removeAllTables(cb);
	});

	tasks.push(function (cb) {
		es.indices.delete({'index': '*'}, cb);
	});

	async.parallel(tasks, function (err) {
		if (err) throw err;
		done();
	});
});

describe('MariaDB migrations', function () {
	this.timeout(10000);
	this.slow(300);

	it('Run them', function (done) {
		let	dbMigrations;

		mariaDbConf.migrationScriptsPath	= path.join(__dirname, '../testmigrations_mariadb');
		mariaDbConf.dbType	= 'larvitdb';
		mariaDbConf.dbDriver	= db;

		dbMigrations = new DbMigration(mariaDbConf);

		dbMigrations.run(function (err) {
			if (err) throw err;

			done();
		});
	});

	it('Should fetch some data form a migrated table', function (done) {
		db.query('SELECT * FROM bloj', function (err, rows) {
			if (err) throw err;

			assert.deepStrictEqual(rows.length,	1);
			assert.deepStrictEqual(rows[0].hasse,	42);
			done();
		});
	});

	it('Make sure function works', function (done) {
		db.query('SELECT multi_two(4) AS foo', function (err, rows) {
			if (err) throw err;

			assert.deepStrictEqual(rows[0].foo,	8);
			done();
		});
	});

	it('Make sure function nr 2 works', function (done) {
		db.query('SELECT multi_three(4) AS foo', function (err, rows) {
			if (err) throw err;

			assert.deepStrictEqual(rows[0].foo,	12);
			done();
		});
	});
});

describe('Elasticsearch migrations', function () {
	let	esUri;

	this.slow(300);

	it('Run them', function (done) {
		let	dbMigrations;

		esUri	= 'http://' + es.transport._config.host;

		esConf.migrationScriptsPath	= path.join(__dirname, '../testmigrations_elasticsearch');
		esConf.dbType	= 'elasticsearch';
		esConf.dbDriver	= es;

		dbMigrations = new DbMigration(esConf);

		dbMigrations.run(function (err) {
			if (err) throw err;

			done();
		});
	});

	it('should check the db_versions index', function (done) {
		request(esUri + '/db_version/db_version/1', function (err, response, body) {
			const	jsonBody	= JSON.parse(body);

			if (err) throw err;

			assert.strictEqual(jsonBody._source.version,	2);
			assert.strictEqual(jsonBody._source.status,	'finnished');

			done();
		});
	});

	it('should check the foo index', function (done) {
		request(esUri + '/foo/bar/666', function (err, response, body) {
			const	jsonBody	= JSON.parse(body);

			if (err) throw err;

			assert.strictEqual(jsonBody._source.blubb,	7);

			done();
		});
	});

	it('run them again', function (done) {
		let	dbMigrations;

		esUri	= 'http://' + es.transport._config.host;

		esConf.migrationScriptsPath	= path.join(__dirname, '../testmigrations_elasticsearch');
		esConf.dbType	= 'elasticsearch';
		esConf.dbDriver	= es;

		dbMigrations = new DbMigration(esConf);

		dbMigrations.run(function (err) {
			if (err) throw err;

			done();
		});
	});
});
