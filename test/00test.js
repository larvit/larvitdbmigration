'use strict';

require('dotenv').config();

const DbMigration = require(__dirname + '/../index.js');
const request = require('request');
const assert = require('assert');
const Lutils = require('larvitutils');
const lutils = new Lutils();
const async = require('async');
const path = require('path');
const log = new lutils.Log('error');
const Db = require('larvitdb');

let mariaDbConf;
let esConf;
let db;

before(async () => {
	// Setup MariaDB
	const mariaConf = {
		host: process.env.DB_HOST || '127.0.0.1',
		user: process.env.DB_USER || 'root',
		port: process.env.DB_PORT || '3306',
		password: process.env.DB_PASSWORD || 'toor',
		database: process.env.DB_DATABASE || 'test'
	};
	db = new Db(mariaConf);
	const {rows} = await db.query('SHOW TABLES');

	if (rows.length) {
		log.error('Database is not empty. To make a test, you must supply an empty database!');
		process.exit(1);
	}
/*
	// Setup ES
	const esConf = {
		host: process.env.ES_HOST || '127.0.0.1:9300'
	};

	function checkEmptyEs() {
		const reqOptions = {};

		reqOptions.url = 'http://' + esConf.host + '/_cat/indices?format=json';
		reqOptions.json = true;

		return new Promise((resolve, reject) => {
			request(reqOptions, function (err, response, body) {
				if (err) return reject(err);

				if (!Array.isArray(body) || body.length !== 0) {
					return reject(new Error('Database is not empty. To make a test, you must supply an empty database!'));
				}

				resolve();
			});
		});
	}
	await checkEmptyEs();
	*/
});

after(async () => {
	await db.removeAllTables();
	await db.pool.end();
/*
	await new Promise((resolve, reject) => {
		const reqOptions = {};

		reqOptions.url = 'http://' + esConf.host + '/_all';
		reqOptions.json = true;
		reqOptions.method = 'DELETE';

		request(reqOptions, err => {
			if (err) reject(err);
			else resolve();
		});
	});
*/
});

describe('MariaDB migrations', function () {
	this.timeout(10000);
	this.slow(300);

	it('Run them', async () => {
		const dbMigrations = new DbMigration({
			migrationScriptPath: path.join(__dirname, '../testmigrations_mariadb'),
			dbType: 'mariadb',
			dbDriver: db,
			log
		});

		await dbMigrations.run();
	});

	it('Should fetch some data form a migrated table', async () => {
		const {rows} = await db.query('SELECT * FROM bloj');

		assert.deepStrictEqual(rows.length, 1);
		assert.deepStrictEqual(rows[0].hasse, 42);
	});

	it('Make sure function works', async () => {
		const {rows} = await db.query('SELECT multi_two(4) AS foo');

		assert.deepStrictEqual(rows[0].foo, 8);
	});

	it('Make sure function nr 2 works', async () => {
		const {rows} = await db.query('SELECT multi_three(4) AS foo');

		assert.deepStrictEqual(rows[0].foo, 12);
	});

	it('Should fail when migration returns error', async () => {
		await db.removeAllTables();

		// Run failing migrations
		const dbMigrations = new DbMigration({
			migrationScriptPath: path.join(__dirname, '../testmigrations_mariadb_failing'),
			dbType: 'mariadb',
			dbDriver: db,
			log
		});

		let thrownErr;

		try {
			await dbMigrations.run();
		} catch (err) {
			thrownErr = err;
		}

		assert(thrownErr instanceof Error, 'err should be an instance of Error');
		assert.strictEqual(thrownErr.message, 'some error');
	});
});

/*
describe('Elasticsearch migrations', function () {
	this.slow(300);

	it('Run them', function (done) {
		let dbMigrations;

		esConf.dbType = 'elasticsearch';
		esConf.url = 'http://' + esConf.clientOptions.host;
		esConf.migrationScriptPath = path.join(__dirname, '../testmigrations_elasticsearch');
		esConf.log = log;

		dbMigrations = new DbMigration(esConf);

		dbMigrations.run(function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should check the db_versions index', function (done) {
		request('http://' + esConf.clientOptions.host + '/db_version/db_version/1', function (err, response, body) {
			const jsonBody = JSON.parse(body);

			if (err) throw err;

			assert.strictEqual(jsonBody._source.version, 2);
			assert.strictEqual(jsonBody._source.status, 'finnished');

			done();
		});
	});

	it('should check the foo index', function (done) {
		request('http://' + esConf.clientOptions.host + '/foo/bar/666', function (err, response, body) {
			const jsonBody = JSON.parse(body);

			if (err) throw err;

			assert.strictEqual(jsonBody._source.blubb, 7);

			done();
		});
	});

	it('run them again', function (done) {
		let dbMigrations;

		esConf.dbType = 'elasticsearch';
		esConf.url = 'http://' + esConf.clientOptions.host;
		esConf.migrationScriptPath = path.join(__dirname, '../testmigrations_elasticsearch');
		esConf.log = log;

		dbMigrations = new DbMigration(esConf);

		dbMigrations.run(function (err) {
			if (err) throw err;
			done();
		});
	});
});
/**/
