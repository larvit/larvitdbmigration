import axios, { AxiosInstance } from 'axios';
import { Log, LogInstance } from 'larvitutils';
import ElasticsearchDriver, { ElasticsearchDriverOptions } from './dbType/elasticsearch';
import MariaDbDriver, { MariaDbDriverOptions } from './dbType/mariadb';

const topLogPrefix = 'larvitdbmigration: index.js -';

export type DbMigrationOptions = {
	dbType: 'mariadb' | 'elasticsearch',
	dbDriver?: any,
	context?: object,
	tableName?: string,
	indexName?: string,
	migrationScriptPath?: string,
	log?: LogInstance,
	axios?: AxiosInstance,
	url?: string,
};

export class DbMigration {
	driver: MariaDbDriver | ElasticsearchDriver;
	options: DbMigrationOptions;

	/**
	 * Module main constructor
	 *
	 * @param {object} options -
	 * @param {String} options.dbType - "mariadb" or "elasticsearch"
	 * @param {object} options.dbDriver - instance of your mariadb database driver. For example larvitdb.
	 * @param {object} [options.context] - Context that can carry arbitrary information to the migrations (such as an instance of the lib that is doing the migrations)
	 * @param {String} [options.tableName="db_version"] -
	 * @param {String} [options.indexName="db_version"] -
	 * @param {String} [options.url] - must be specified if dbType is "elasticsearch"
	 * @param {String} [options.axios] - optional axios instance to be used if dbType is "elasticsearch"
	 * @param {String} [options.migrationScriptPath="./dbmigration"] -
	 * @param {object} [options.log=instance of lutils.Log()] -
	 */
	constructor(options: DbMigrationOptions) {
		const logPrefix = `${topLogPrefix} DbMigration() - `;

		options = options || {};

		if (!options.log) {
			options.log = new Log();
		}

		const log = options.log;

		if (options.tableName === undefined) options.tableName = 'db_version';
		if (options.indexName === undefined) options.indexName = 'db_version';
		if (options.migrationScriptPath === undefined) options.migrationScriptPath = './dbmigration';

		if (options.dbType !== 'elasticsearch' && options.dbType !== 'mariadb') {
			throw new Error('Only dbType "elasticsearch" and "mariadb" are supported, please choose one');
		}

		if (options.dbType === 'elasticsearch' && !options.url) {
			throw new Error('Option "url" must be specified when dbType is "elasticsearch"');
		}

		// Resolve ./ paths to be relative to application path
		if (options.migrationScriptPath.substring(0, 2) === './') {
			options.migrationScriptPath = process.cwd() + '/' + options.migrationScriptPath.substring(2);
		}

		if (options.dbType === 'mariadb') {
			this.driver = new MariaDbDriver(options as MariaDbDriverOptions);
			log.verbose(`${logPrefix} Started with dbType: "mariadb", tableName: "${options.tableName}", migrationScriptPath: "${options.migrationScriptPath}"`);
		} else {
			options.axios = options.axios ?? axios.create();
			this.driver = new ElasticsearchDriver(options as ElasticsearchDriverOptions);
			log.verbose(`${logPrefix} Started with dbType: "elasticsearch", indexName: "${options.indexName}", migrationScriptPath: "${options.migrationScriptPath}"`);
		}

		this.options = options;
	}

	async run(): Promise<void> {
		await this.driver.run.apply(this.driver);
	}
}
