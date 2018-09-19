'use strict';

const topLogPrefix = 'larvitdbmigration: index.js - ';
const LUtils       = require('larvitutils');
const lUtils       = new LUtils();

/**
 * Module main constructor
 * 	'dbType': 'mariadb' or 'elasticsearch'
 * 	'dbDriver': instance of your database driver. For example larvitdb
 *
 * @param {obj} options - {
 *
 * 	**OPTIONAL**
 * 	'tableName': 'db_version'
 * 	'indexName': 'db_version'
 * 	'migrationScriptPath': './dbmigration'
 * 	'log': new larvitutils.Log() or compatible
 * }
 */
function DbMigration(options) {
	const logPrefix	= topLogPrefix + 'DbMigration() - ';
	const that      = this;

	if (that === undefined) {
		throw new Error('DbMigration must be instantianted');
	}

	that.options	= options = options || {};

	if (! that.options.log) {
		that.options.log = new lUtils.Log();
	}

	that.log = that.options.log;

	if (options.tableName === undefined) options.tableName = 'db_version';
	if (options.indexName === undefined) options.indexName = 'db_version';
	if (options.migrationScriptsPath === undefined) options.migrationScriptsPath = './dbmigration';

	if (options.dbType !== 'elasticsearch' && options.dbType !== 'mariadb') {
		throw new Error('Only dbType "elasticsearch" and "mariadb" are supported, please choose one');
	}

	// Resolve ./ paths to be relative to application path
	if (that.options.migrationScriptsPath.substring(0, 2) === './') {
		that.options.migrationScriptsPath = process.cwd() + '/' + that.options.migrationScriptsPath.substring(2);
	}

	that.dbTypeFile = __dirname + '/dbType/' + options.dbType + '.js';
	that.DbType = require(that.dbTypeFile);
	that.dbType = new that.DbType(that.options);
	that.dbType.log = that.log;

	that.log.verbose(logPrefix + 'Started with dbType: "' + that.options.dbType + '", tableName/indexName: "' + (that.options.tableName || that.options.indexName) + '", migrationScriptsPath: "' + that.options.migrationScriptsPath + '"');

	// Set functions from the dirver
	that.getLock = that.dbType.getLock;
	that.rmLock = that.dbType.rmLock;
	that.run = that.dbType.run;
	that.runScripts = that.dbType.runScripts;
}

exports = module.exports = DbMigration;
