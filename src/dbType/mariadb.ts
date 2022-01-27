import { LogInstance, Utils } from 'larvitutils';
import mysql from 'mysql2';
import fs from 'fs';

const topLogPrefix = 'larvitdbmigration: dbType/mariadb.js: ';

export type MariaDbDriverOptions = {
	tableName: string,
	dbDriver: any,
	context?: object,
	migrationScriptPath: string,
	log: LogInstance
};

export default class MariaDbDriver {
	private lUtils: Utils;
	private options: MariaDbDriverOptions;

	/**
	 * MariaDB driver
	 *
	 * @param {object} options -
	 * @param {String} options.tableName -
	 * @param {object} options.dbDriver -
	 * @param {String} options.migrationScriptPath -
	 * @param {object} options.log -
	 */
	constructor(options: MariaDbDriverOptions) {
		/* istanbul ignore if */
		if (!options) throw new Error('Options parameter is missing');
		/* istanbul ignore if */
		if (!options.tableName) throw new Error('Missing required option "tableName"');
		/* istanbul ignore if */
		if (!options.dbDriver) throw new Error('Missing option dbDriver');
		/* istanbul ignore if */
		if (!options.log) throw new Error('Missing option log');

		this.lUtils = new Utils({ log: options.log });
		this.options = options;
	}

	async getLock(): Promise<void> {
		const { lUtils } = this;
		const { tableName, log } = this.options;
		const logPrefix = topLogPrefix + 'getLock() - tableName: "' + tableName + '" - ';
		const db = this.options.dbDriver;

		const dbCon = await db.pool.getConnection();

		await dbCon.query('LOCK TABLES `' + tableName + '` WRITE;');
		const [rows] = await dbCon.query('SELECT running FROM `' + tableName + '`');
		/* istanbul ignore next */ // Difficult to test without mocks
		if (rows.length === 0) {
			const errMsg = 'No database records';

			log.error(logPrefix + errMsg);
			throw new Error(errMsg);
		} else if (rows[0].running !== 0) {
			await dbCon.query('UNLOCK TABLES;');
			log.info(logPrefix + 'Another process is running the migrations, wait and try again soon.');
			await lUtils.setTimeout(500);
			await this.getLock();
		}

		await dbCon.query('UPDATE `' + tableName + '` SET running = 1');
		await dbCon.query('UNLOCK TABLES;');

		dbCon.release();
	}

	async run(): Promise<void> {
		const { tableName, log } = this.options;
		const logPrefix = topLogPrefix + 'run() - tableName: "' + tableName + '" - ';
		const db = this.options.dbDriver;

		// Create table if it does not exist
		await db.query('CREATE TABLE IF NOT EXISTS `' + tableName + '` (`id` tinyint(1) unsigned NOT NULL DEFAULT \'1\', `version` int(10) unsigned NOT NULL DEFAULT \'0\', `running` tinyint(3) unsigned NOT NULL DEFAULT \'0\', PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin COMMENT=\'Used for automatic database versioning. Do not modify!\';');

		// Update old version of table (for seamless updating of old versions of this module)
		const descRes = await db.query('DESCRIBE `' + tableName + '`');
		/* istanbul ignore next */
		if (descRes.rows.length === 2 && descRes.rows[0].Field === 'version' && descRes.rows[1].Field === 'running') {
			// Old version detected! Update!
			await db.query('ALTER TABLE `' + tableName + '` ADD `id` tinyint(1) unsigned NOT NULL DEFAULT \'1\' FIRST;');
			await db.query('ALTER TABLE `' + tableName + '` ADD PRIMARY KEY `id` (`id`);');
		}

		// Insert first record if it does not exist
		await db.query('INSERT IGNORE INTO `' + tableName + '` VALUES(1, 0, 0);');

		// Lock table by setting the running column to 1
		await this.getLock();

		// Get current version
		const verRes = await db.query('SELECT version FROM `' + tableName + '`;');
		const curVer = verRes.rows[0].version;

		log.info(logPrefix + 'Current database version is ' + curVer);

		// Run scripts
		await this.runScripts(Number(curVer) + 1);

		// Unlock table
		await db.query('UPDATE `' + tableName + '` SET running = 0;');
	}

	async runScripts(startVersion: number): Promise<void> {
		const { tableName, log, migrationScriptPath, context } = this.options;
		const logPrefix = topLogPrefix + 'runScripts() - tableName: "' + tableName + '" - ';
		const db = this.options.dbDriver;

		log.verbose(logPrefix + 'Started with startVersion: "' + startVersion + '" in path: "' + migrationScriptPath + '"');

		// Get items in the migration script path
		const items = await new Promise<string[]>((resolve, reject) => {
			fs.readdir(migrationScriptPath, (err, items) => {
				/* istanbul ignore if */ // Difficult to test without mocks
				if (err) {
					log.error(logPrefix + 'Could not read migration script path "' + migrationScriptPath + '", err: ' + err.message);
					reject(err);
				} else {
					resolve(items);
				}
			});
		});

		// Loop through the items and see what kind of migration scripts it is
		for (const item of items) {
			if (item === startVersion + '.js') {
				log.info(logPrefix + 'Found js migration script #' + startVersion + ', running it now.');

				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const migrationScript = require(migrationScriptPath + '/' + startVersion + '.js');

				await migrationScript({ db, log, context });
				log.debug(logPrefix + 'Js migration script #' + startVersion + ' ran. Updating database version and moving on.');
				await db.query('UPDATE `' + tableName + '` SET version = ' + startVersion + ';');
				await this.runScripts(startVersion + 1);
			} else if (item === startVersion + '.sql') {
				log.info(logPrefix + 'Found sql migration script #' + startVersion + ', running it now.');

				const localDbConf: Record<string, string | number | boolean> = {};

				const validDbOptions = [
					'host', 'port', 'localAddress',
					'socketPath', 'user', 'password',
					'database', 'charset', 'timezone',
					'connectTimeout', 'stringifyObjects', 'insecureAuth',
					'typeCast', 'queryFormat', 'supportBigNumbers',
					'bigNumberStrings', 'dateStrings', 'debug',
					'trace', 'multipleStatements', 'flags',
					'ssl',

					// Valid for pools
					'waitForConnections', 'connectionLimit', 'queueLimit',
				];

				for (const key of Object.keys(db.dbConf)) {
					if (validDbOptions.indexOf(key) !== -1) {
						localDbConf[key] = db.dbConf[key];
					}
				}
				localDbConf.multipleStatements = true;
				const dbCon = mysql.createConnection(localDbConf);

				await new Promise<void>((resolve, reject) => {
					dbCon.query(fs.readFileSync(migrationScriptPath + '/' + item).toString(), err => {
						/* istanbul ignore if */ // Difficult to test without mocks
						if (err) {
							log.error(logPrefix + 'Migration file: ' + item + ' SQL error: ' + err.message);

							return reject(err);
						}

						log.info(logPrefix + 'Sql migration script #' + startVersion + ' ran. Updating database version and moving on.');
						resolve();
					});
				});

				await db.query('UPDATE `' + tableName + '` SET version = ' + startVersion + ';');

				dbCon.end();

				await this.runScripts(startVersion + 1);
			}
		}
	}
}
