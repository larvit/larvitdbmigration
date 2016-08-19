'use strict';

const	assert	= require('assert'),
	path	= require('path'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

let dbConf;

// Set up winston
log.remove(log.transports.Console);
log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});

before(function(done) {
	let	confFile;

	function checkEmptyDb() {
		db.query('SHOW TABLES', function(err, rows) {
			if (err) {
				log.error(err);
				assert( ! err, 'err should be negative');
				process.exit(1);
			}

			if (rows.length) {
				log.error('Database is not empty. To make a test, you must supply an empty database!');
				assert.deepEqual(rows.length, 0);
				process.exit(1);
			}

			done();
		});
	}

	function runDbSetup(confFile) {
		log.verbose('DB config: ' + JSON.stringify(require(confFile)));

		db.setup(require(confFile), function(err) {
			assert( ! err, 'err should be negative');

			checkEmptyDb();
		});
	}

	if (process.argv[3] === undefined) {
		confFile = __dirname + '/../config/db_test.json';
	} else {
		confFile = process.argv[3].split('=')[1];
	}

	log.verbose('DB config file: "' + confFile + '"');

	fs.stat(confFile, function(err) {
		const altConfFile = __dirname + '/../config/' + confFile;

		if (err) {
			log.info('Failed to find config file "' + confFile + '", retrying with "' + altConfFile + '"');

			fs.stat(altConfFile, function(err) {
				assert( ! err, 'fs.stat failed: ' + err.message);

				if ( ! err) {
					dbConf = require(altConfFile);
					runDbSetup(altConfFile);
				}
			});
		} else {
			dbConf = require(confFile);
			runDbSetup(confFile);
		}
	});
});

after(function(done) {
	db.removeAllTables(done);
});

describe('Migrations', function() {
	it('Run them', function(done) {
		let dbMigrations;

		dbConf.migrationScriptsPath = path.join(__dirname, '../testmigrations');

		dbMigrations = require('../index.js')(dbConf);

		dbMigrations(function(err) {
			console.log(err);
			assert( ! err, 'err should be negative');

			done();
		});
	});

	it('Should fetch some data form a migrated table', function(done) {
		db.query('SELECT * FROM bloj', function(err, rows) {
			assert( ! err, 'err should be negative');

			assert.deepEqual(rows.length, 1);
			assert.deepEqual(rows[0].hasse, 42);
			done();
		});
	});

	/*it('Make sure function works', function(done) {
		db.query('SELECT multi_two(4)', function(err, rows) {
			assert( ! err, 'err should be negative');

			assert.deepEqual(rows[0], 8);
			done();
		});
	});*/
});
