'use strict';

const	DbMigration	= require(__dirname + '/../index.js'),
	request	= require('request'),
	assert	= require('assert'),
	Lutils	= require('larvitutils'),
	lutils	= new Lutils(),
	async	= require('async'),
	path	= require('path'),
	log	= new lutils.Log('silence!!!'),
	db	= require('larvitdb'),
	fs	= require('fs');

let	mariaDbConf,
	esConf;

before(function (done) {
	const	tasks	= [];

	let	mariaDbConfFile,
		esConfFile;

	// Set conf file paths
	tasks.push(function (cb) {
		if (process.env.ESCONFFILE === undefined) {
			esConfFile	= __dirname + '/../config/es_test.json';
		} else {
			esConfFile	= process.env.ESCONFFILE;
		}

		if (process.env.DBCONFFILE === undefined) {
			mariaDbConfFile	= __dirname + '/../config/db_test.json';
		} else {
			mariaDbConfFile	= process.env.DBCONFFILE;
		}

		log.verbose('MariaDB config file: "' + mariaDbConfFile + '"');
		log.verbose('Elasticsearch config file: "' + esConfFile + '"');

		cb();
	});

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

					mariaDbConf	= require(altMariaDbConfFile);
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
			const	reqOptions	= {};

			reqOptions.url	= 'http://' + esConf.clientOptions.host + '/_cat/indices?format=json';
			reqOptions.json	= true;

			request(reqOptions, function (err, response, body) {
				if (err) throw err;

				if ( ! Array.isArray(body) || body.length !== 0) {
					throw new Error('Database is not empty. To make a test, you must supply an empty database!');
					process.exit(1);
				}

				cb(err);
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

					esConf	= require(altEsConfFile);
					checkEmptyEs(altEsConfFile);
				});
			} else {
				esConf	= require(esConfFile);
				checkEmptyEs(esConfFile);
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
		const	reqOptions	= {};

		reqOptions.url	= 'http://' + esConf.clientOptions.host + '/_all';
		reqOptions.json	= true;
		reqOptions.method	= 'DELETE';

		request(reqOptions, cb);
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
		mariaDbConf.dbType	= 'mariadb';
		mariaDbConf.dbDriver	= db;
		mariaDbConf.log	= log;

		dbMigrations	= new DbMigration(mariaDbConf);

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

	it('Should fail when migration returns error', function (done) {
		const	tasks	= [];

		// Clean out database
		tasks.push(function (cb) {
			db.removeAllTables(cb);
		});

		// Run failing migrations
		tasks.push(function (cb) {
			let	dbMigrations;

			mariaDbConf.migrationScriptsPath	= path.join(__dirname, '../testmigrations_mariadb_failing');
			mariaDbConf.dbType	= 'mariadb';
			mariaDbConf.dbDriver	= db;
			mariaDbConf.log	= log;

			dbMigrations	= new DbMigration(mariaDbConf);

			dbMigrations.run(function (err) {
				assert(err instanceof Error, 'err should be an instance of Error');

				cb();
			});
		});

		async.series(tasks, done);
	});
});

describe('Elasticsearch migrations', function () {
	this.slow(300);

	it('Run them', function (done) {
		let	dbMigrations;

		esConf.dbType	= 'elasticsearch';
		esConf.url	= 'http://' + esConf.clientOptions.host;
		esConf.migrationScriptsPath	= path.join(__dirname, '../testmigrations_elasticsearch');
		esConf.log	= log;

		dbMigrations	= new DbMigration(esConf);

		dbMigrations.run(function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should check the db_versions index', function (done) {
		request('http://' + esConf.clientOptions.host + '/db_version/db_version/1', function (err, response, body) {
			const	jsonBody	= JSON.parse(body);

			if (err) throw err;

			assert.strictEqual(jsonBody._source.version,	2);
			assert.strictEqual(jsonBody._source.status,	'finnished');

			done();
		});
	});

	it('should check the foo index', function (done) {
		request('http://' + esConf.clientOptions.host + '/foo/bar/666', function (err, response, body) {
			const	jsonBody	= JSON.parse(body);

			if (err) throw err;

			assert.strictEqual(jsonBody._source.blubb,	7);

			done();
		});
	});

	it('run them again', function (done) {
		let	dbMigrations;

		esConf.dbType	= 'elasticsearch';
		esConf.url	= 'http://' + esConf.clientOptions.host;
		esConf.migrationScriptsPath	= path.join(__dirname, '../testmigrations_elasticsearch');
		esConf.log	= log;

		dbMigrations	= new DbMigration(esConf);

		dbMigrations.run(function (err) {
			if (err) throw err;
			done();
		});
	});
});
