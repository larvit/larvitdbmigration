'use strict';

const topLogPrefix = 'larvitdbmigration: index.js - ';
const { Utils } = require('larvitutils');
const lUtils = new Utils();

/**
 * Module main constructor
 *
 * @param {object} options -
 * @param {String} options.dbType - "mariadb" or "elasticsearch"
 * @param {object} options.dbDriver - instance of your database driver. For example larvitdb
 * @param {String} [options.tableName="db_version"] -
 * @param {String} [options.indexName="db_version"] -
 * @param {String} [options.migrationScriptPath="./dbmigration"] -
 * @param {object} [options.log=instance of lutils.Log()] -
 */
function DbMigration(options) {
	const logPrefix = topLogPrefix + 'DbMigration() - ';

	options = options || {};

	if (!options.log) {
		options.log = new lUtils.Log();
	}

	const log = options.log;

	if (options.tableName === undefined) options.tableName = 'db_version';
	if (options.indexName === undefined) options.indexName = 'db_version';
	if (options.migrationScriptPath === undefined) options.migrationScriptPath = './dbmigration';

	if (options.dbType !== 'elasticsearch' && options.dbType !== 'mariadb') {
		throw new Error('Only dbType "elasticsearch" and "mariadb" are supported, please choose one');
	}

	// Resolve ./ paths to be relative to application path
	if (options.migrationScriptPath.substring(0, 2) === './') {
		options.migrationScriptPath = process.cwd() + '/' + options.migrationScriptPath.substring(2);
	}

	this.dbTypeFile = __dirname + '/dbType/' + options.dbType + '.js';
	this.DbType = require(this.dbTypeFile);
	this.dbType = new this.DbType(options);

	log.verbose(logPrefix + 'Started with dbType: "' + options.dbType + '", tableName/indexName: "' + (options.tableName || options.indexName) + '", migrationScriptPath: "' + options.migrationScriptPath + '"');

	this.options = options;

	// Set functions from the driver
	this.run = () => this.dbType.run.apply(this.dbType, arguments);
}

exports = module.exports = DbMigration;
