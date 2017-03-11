'use strict';

const	jsonStringify	= require('json-stringify-safe'),
	topLogPrefix	= 'larvitdbmigration: index.js - ',
	log	= require('winston'),
	fs	= require('fs');

function DbMigration(options) {
	const	logPrefix	= topLogPrefix + 'DbMigration() - ',
		that	= this;

	that.options = options = options || {};

	if (options.tableName	=== undefined) options.tableName	= 'db_version';
	if (options.migrationScriptsPath	=== undefined) options.migrationScriptsPath	= './dbmigration';

	if (options.dbType === undefined) {
		throw new Error('Missing options.dbType');
	}

	that.dbTypeFile	= __dirname + '/dbType/' + options.dbType + '.js';

	if ( ! fs.existsSync(that.dbTypeFile)) {
		throw new Error('Invalid options.dbType "' + options.dbType + '", missing file: "' + dbTypeFile + '"');
	}

	if (options.dbType !== 'larvitdb' && options.dbType !== 'elasticsearch') {
		throw new Error('Invalid options.dbType: "' + options.dbType + '"');
	}

	if (options.dbDriver === undefined) {
		throw new Error('Missing options.dbDriver');
	}

	log.verbose(logPrefix + 'Started with options: ' + jsonStringify(options));

	// Resolve ./ paths to be relative to application path
	if (options.migrationScriptsPath.substring(0, 2) === './') {
		options.migrationScriptsPath = process.cwd() + '/' + options.migrationScriptsPath.substring(2);
	}

	// Set functions from dbDriver
	that.getLock	= require(that.dbTypeFile).getLock;
	that.rmLock	= require(that.dbTypeFile).rmLock;
	that.run	= require(that.dbTypeFile).run;
	that.runScripts	= require(that.dbTypeFile).runScripts;
}

exports = module.exports = DbMigration;
