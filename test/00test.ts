import dotenv from 'dotenv';


import { Utils } from 'larvitutils';
import assert from 'assert';
import Db from 'larvitdb';
import { DbMigration, DbMigrationOptions } from '../src/index';
import got from 'got';
import path from 'path';
import nock from 'nock';

const lutils = new Utils();
const log = new lutils.Log('debug');

let db: any;

dotenv.config();

const esConf = {
	host: process.env.ES_HOST !== undefined ? process.env.ES_HOST : '127.0.0.1:9200',
};

before(async () => {
	// Setup MariaDB
	const mariaConf = {
		host: process.env.DB_HOST !== undefined ? process.env.DB_HOST : '127.0.0.1',
		user: process.env.DB_USER !== undefined ? process.env.DB_USER : 'root',
		port: process.env.DB_PORT !== undefined ? process.env.DB_PORT : '3306',
		password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'toor',
		database: process.env.DB_DATABASE !== undefined ? process.env.DB_DATABASE : 'test',
	};
	log.debug(`mariaConf: ${JSON.stringify(mariaConf)}`);
	db = new Db(mariaConf as unknown);

	await db.removeAllTables();

	const { rows } = await db.query('SHOW TABLES');

	if (rows.length) {
		log.error('Database is not empty. To make a test, you must supply an empty database!');
		process.exit(1);
	}

	// Setup ES
	log.debug(`esConf: ${JSON.stringify(esConf)}`);

	log.debug('Deleting all indices from ES, host');
	await got.delete(`http://${esConf.host}/_all`);

	log.debug('Check that all indices are deleted from ES');
	const jsonBody = await got(`http://${esConf.host}/_cat/indices?format=json`).json();
	if (!Array.isArray(jsonBody) || jsonBody.length !== 0) {
		throw new Error('Elasticsearch is not empty. To make a test, you must supply an empty database!');
	}
});

after(async () => {
	await db.removeAllTables();
	await db.pool.end();
	await got.delete(`http://${esConf.host}/_all`);
});

describe('General', () => {
	it('Can be constructed without logger in options', async () => {
		assert.doesNotThrow(() => new DbMigration({
			dbType: 'mariadb',
			dbDriver: db,
		}));
	});

	it('Throws an exception if dbType option is invalid', async () => {
		assert.throws(() => new DbMigration({
			dbType: 'not-a-valid-dbtype' as any,
		}));
	});

	it('Throws an exception if dbType is elasticsearch but no url is provided', async () => {
		assert.throws(() => new DbMigration({
			dbType: 'elasticsearch',
		}));
	});

	it('Throws an exception if no options are provided', async () => {
		assert.throws(() => new DbMigration(undefined as unknown as DbMigrationOptions));
	});

	it('Option tablename defaults to db_version', async () => {
		const dbMigration = new DbMigration({
			dbType: 'mariadb',
			dbDriver: db,
		});

		assert.strictEqual(dbMigration.options.tableName, 'db_version');
	});

	it('Option indexname defaults to db_version', async () => {
		const dbMigration = new DbMigration({
			dbType: 'elasticsearch',
			url: 'localhost:9200',
		});

		assert.strictEqual(dbMigration.options.indexName, 'db_version');
	});
});

describe('MariaDB migrations', function () {
	this.timeout(10000);
	this.slow(300);

	it('Run them', async () => {
		const dbMigrations = new DbMigration({
			migrationScriptPath: path.join(__dirname, '../testmigrations_mariadb'),
			dbType: 'mariadb',
			dbDriver: db,
			log,
		});

		await dbMigrations.run();
	});

	it('Should fetch some data form a migrated table', async () => {
		const { rows } = await db.query('SELECT * FROM bloj');

		assert.deepStrictEqual(rows.length, 1);
		assert.deepStrictEqual(rows[0].hasse, 42);
	});

	it('Make sure function works', async () => {
		const { rows } = await db.query('SELECT multi_two(4) AS foo');

		assert.deepStrictEqual(rows[0].foo, 8);
	});

	it('Make sure function nr 2 works', async () => {
		const { rows } = await db.query('SELECT multi_three(4) AS foo');

		assert.deepStrictEqual(rows[0].foo, 12);
	});

	it('Should fail when migration returns error', async () => {
		await db.removeAllTables();

		// Run failing migrations
		const dbMigrations = new DbMigration({
			migrationScriptPath: path.join(__dirname, '../testmigrations_mariadb_failing'),
			dbType: 'mariadb',
			dbDriver: db,
			log,
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

describe('Elasticsearch migrations', () => {
	function createEsMigration(options: {
		migrationScriptPath?: string,
	} = {
		migrationScriptPath: path.join(__dirname, '../testmigrations_elasticsearch'),
	}): DbMigration {
		return new DbMigration({
			dbType: 'elasticsearch',
			url: `http://${esConf.host}`,
			migrationScriptPath: options.migrationScriptPath,
			log: log,
			got: got.extend({ retry: 0 }),
		});
	}

	async function assertThrows(fn: () => unknown, partOfMessage: string): Promise<void> {
		try {
			await fn();
		} catch (_err) {
			const err = _err as Error;
			assert.ok(err.message.includes(partOfMessage));

			return;
		}

		assert.fail(`Did not get expected part of exception message: ${partOfMessage}`);
	}

	beforeEach(async () => {
		await got.delete(`http://${esConf.host}/_all`);
	});

	it('should fail when HEAD returns unexpected status code when checking for index', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.head('/db_version')
			.reply(500, 'Internal error');

		await assertThrows(async () => await dbMigrations.run(), 'HEAD http://127.0.0.1:19200/db_version failed, err: unexpected statusCode: 500');
		ctx.done();
	});

	it('should fail when PUT returns unexpected status code when creating index', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.put('/db_version')
			.reply(500, 'Internal error');

		await assertThrows(async () => await dbMigrations.run(), 'PUT http://127.0.0.1:19200/db_version failed, err: Unexpected statusCode: 500, body: Internal error');
		ctx.done();
	});

	it('should fail when PUT fails with exception when creating index', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.put('/db_version')
			.replyWithError('Nasty error');

		await assertThrows(async () => await dbMigrations.run(), 'PUT http://127.0.0.1:19200/db_version failed, err: Nasty error');
		ctx.done();
	});


	it('should fail when GET fails with exception when trying to get version document', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.get('/db_version/_doc/1')
			.replyWithError('Nasty error');

		await assertThrows(async () => await dbMigrations.run(), 'GET http://127.0.0.1:19200/db_version/_doc/1 failed, err: Nasty error');
		ctx.done();
	});

	it('should fail when GET fails with unexpected status code when trying to get version document', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.get('/db_version/_doc/1')
			.reply(500, 'Internal error');

		await assertThrows(async () => await dbMigrations.run(), 'Unexpected statusCode when getting database version document: 500, body: Internal error');
		ctx.done();
	});

	it('should fail when version document returns bad JSON', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.get('/db_version/_doc/1')
			.reply(200, '{"bad": json}');

		await assertThrows(async () => await dbMigrations.run(), 'GET http://127.0.0.1:19200/db_version/_doc/1 failed, err: SyntaxError: Unexpected token j in JSON at position 8, body: {"bad": json}');
		ctx.done();
	});


	it('should fail when POST fails when trying to create version document', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.post('/db_version/_doc/1')
			.reply(500, 'Internal error');

		await assertThrows(async () => await dbMigrations.run(), 'Failed to create version document, statusCode: 500, body: Internal error');
		ctx.done();
	});

	it('should fail when PUT fails with unexpected status code when trying to update version document', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.put('/db_version/_doc/1')
			.reply(500, 'Internal error');

		await assertThrows(async () => await dbMigrations.run(), 'PUT http://127.0.0.1:19200/db_version/_doc/1 failed, err: Unexpected statusCode: 500, body: Internal error');
		ctx.done();
	});

	it('should fail when PUT fails with exception when trying to update version document', async () => {
		const dbMigrations = createEsMigration();
		const ctx = nock('http://127.0.0.1:19200', { allowUnmocked: true })
			.put('/db_version/_doc/1')
			.replyWithError('Nasty error');

		await assertThrows(async () => await dbMigrations.run(), 'PUT http://127.0.0.1:19200/db_version/_doc/1 failed, err: Nasty error');
		ctx.done();
	});

	it('should fail with exception when running migration script with error', async () => {
		const dbMigrations = createEsMigration({ migrationScriptPath: path.join(__dirname, '../testmigrations_elasticsearch_failure') });

		await assertThrows(async () => await dbMigrations.run(), 'Cannot read property \'trim\' of undefined');
	});

	it('should write failure status to version document when running migration script with error', async () => {
		const dbMigrations = createEsMigration({ migrationScriptPath: path.join(__dirname, '../testmigrations_elasticsearch_failure') });

		try {
			await dbMigrations.run();
		} catch (err) {
			assert.ok(err);
		}

		const doc = await got(`http://${esConf.host}/db_version/_doc/1`).json() as any;
		assert.strictEqual(doc._source.version, 1);
		assert.strictEqual(doc._source.status, 'failed');
	});

	it('should run migrations and check db_versions index', async () => {
		const dbMigrations = createEsMigration();

		await dbMigrations.run();

		const doc = await got(`http://${esConf.host}/db_version/_doc/1`).json() as any;
		assert.strictEqual(doc._source.version, 2);
		assert.strictEqual(doc._source.status, 'finished');
	});

	it('should check the migrated foo index', async () => {
		const dbMigrations = createEsMigration();

		await dbMigrations.run();

		const doc = await got(`http://${esConf.host}/foo/_doc/666`).json() as any;
		assert.strictEqual(doc._source.blubb, 7);
	});

	it('should run migration twice and have the same version in the end', async () => {
		const dbMigrations = createEsMigration();

		await dbMigrations.run();
		await dbMigrations.run();

		const doc = await got(`http://${esConf.host}/db_version/_doc/1`).json() as any;
		assert.strictEqual(doc._source.version, 2);
		assert.strictEqual(doc._source.status, 'finished');
	});
});

