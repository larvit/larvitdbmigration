'use strict';

const topLogPrefix = 'larvitdbmigration: dbType/elasticsearch.js: ';
const request = require('request');
const async = require('async');
const fs = require('fs');

/**
 * Initiate driver
 *
 * @param {object} options -
 * @param {object} options.log -
 * @param {String} options.indexName -
 * @param {String} options.url - ES Url
 * @param {String} options.tableName -
 * @param {String} options.migrationScriptPath -
 */
function Driver(options) {
	for (const option of ['log', 'indexName', 'url', 'tableName', 'migrationScriptPath']) {
		if (!options[option]) {
			throw new Error('Missing required option "' + option + '"');
		}

		this[option] = options[option];
	}
}

Driver.prototype.getLock = function getLock(retries, cb) {
	const {indexName, log, url} = this;
	const logPrefix = topLogPrefix + 'getLock() - indexName: "' + indexName + '" - ';

	if (typeof retries === 'function') {
		cb = retries;
		retries = 0;
	}

	log.debug(logPrefix + 'Started');

	// Source: https://www.elastic.co/guide/en/elasticsearch/guide/current/concurrency-solutions.html
	request({
		method: 'PUT',
		uri: url + '/fs/lock/global/_create',
		json: true,
		body: {}
	}, (err, response) => {
		if (err) {
			log.error(logPrefix + 'Can not get lock on ' + url + '/fs/lock/global/_create');

			return cb(err);
		}

		if (response.statusCode !== 201) {
			if (retries < 100) {
				log.info(logPrefix + 'Another process is running the migrations, retry nr: ' + retries + ', wait and try again soon. StatusCode: ' + response.statusCode);
			} else {
				log.warn(logPrefix + 'Another process is running the migrations, retry nr: ' + retries + ', wait and try again soon. StatusCode: ' + response.statusCode);
			}

			setTimeout(() => this.getLock(retries + 1, cb), 500);

			return;
		}

		log.verbose(logPrefix + 'Locked!');

		cb();
	});
};

Driver.prototype.rmLock = function rmLock(cb) {
	const {indexName, log, url} = this;
	const logPrefix = topLogPrefix + 'rmLock() - indexName: "' + indexName + '" - ';

	log.debug(logPrefix + 'Started');

	request.delete(url + '/fs/lock/global', (err, response) => {
		if (err) {
			log.error(logPrefix + 'Can not clear lock on ' + url + '/fs/lock/global');

			return cb(err);
		}

		if (response.statusCode !== 200) {
			const err = new Error('Lock could not be removed. StatusCode: ' + response.statusCode);

			log.warn(logPrefix + err.message);

			return cb(err);
		}

		log.verbose(logPrefix + 'Unlocked!');
		cb();
	});
};

/**
 * Run the migrations
 *
 * @return {promise} -
 */
Driver.prototype.run = function run() {
	const {indexName, tableName, log, url} = this;
	const logPrefix = topLogPrefix + 'run() - indexName: "' + tableName + '" - ';
	const tasks = [];

	let curDoc;

	log.debug(logPrefix + 'Started');

	function getDoc(cb) {
		const subLogPrefix = logPrefix + 'getDoc() - ';
		const uri = url + '/' + indexName + '/' + indexName + '/1';

		log.debug(subLogPrefix + 'Running for ' + uri);

		request(uri, function (err, response, body) {
			if (err) {
				log.error(subLogPrefix + 'GET ' + uri + ' failed, err: ' + err.message);

				return cb(err);
			}

			log.debug(subLogPrefix + 'GET ' + uri + ' ' + response.statusCode + ' ' + response.statusMessage);

			if (response.statusCode === 200) {
				try {
					curDoc = JSON.parse(body);
				} catch (err) {
					log.error(subLogPrefix + 'GET ' + uri + ' invalid JSON in body, err: ' + err.message + ' string: "' + body + '"');
					cb(err);
				}

				return cb(err, response, body);
			}

			cb(err, response, body);
		});
	}

	// Get lock
	tasks.push(cb => this.getLock(cb));

	// Create index if it does not exist
	tasks.push(cb => {
		const subLogPrefix = logPrefix + 'indexName: "' + indexName + '" - ';
		const uri = url + '/' + indexName;

		log.debug(subLogPrefix + 'Crating index if it did not exist');

		request.head(uri, (err, response) => {
			if (err) {
				log.error(subLogPrefix + 'HEAD ' + uri + ' failed, err: ' + err.message);

				return cb(err);
			}

			if (response.statusCode === 200) {
				log.debug(subLogPrefix + 'Index already exists');

				return cb();
			} else if (response.statusCode !== 404) {
				const err = new Error('HEAD ' + uri + ' unexpected statusCode: ' + response.statusCode);

				log.error(subLogPrefix + err.message);

				return cb(err);
			}

			log.debug(subLogPrefix + 'Index does not exist, create it');

			// If we arrive here its a 404 - create it!
			request.put(uri, function (err, response) {
				if (err) {
					log.error(subLogPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);

					return cb(err);
				}

				if (response.statusCode !== 200) {
					const err = new Error('PUT ' + uri + ', Unexpected statusCode: ' + response.statusCode);

					log.error(subLogPrefix + err.message);

					return cb(err);
				}

				log.debug(subLogPrefix + 'Created!');

				cb();
			});
		});
	});

	// Create document if it does not exist and get current document
	tasks.push(cb => {
		const uri = url + '/' + indexName + '/' + indexName + '/1';

		getDoc((err, response) => {
			if (err) return cb(err);

			if (response.statusCode === 404) {
				log.debug(logPrefix + 'Create database version document');

				request.put({url: uri, json: {version: 0, status: 'finnished'}}, (err, response) => {
					if (err) {
						log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);

						return cb(err);
					}

					if (response.statusCode !== 201) {
						const err = new Error('Failed to create document, statusCode: ' + response.statusCode);

						log.error(logPrefix + err.message);

						return cb(err);
					}

					log.verbose(logPrefix + 'Database version document created');

					getDoc(cb);
				});
			} else if (response.statusCode === 200) {
				log.debug(logPrefix + 'Database version document already exists');
				cb();
			} else {
				const err = new Error('Unexpected statusCode when getting database version document: ' + response.statusCode);

				log.error(logPrefix + err.message);

				return cb(err);
			}
		});
	});

	// Run scripts
	tasks.push(cb => {
		try {
			this.runScripts(curDoc._source.version + 1, cb);
		} catch (err) {
			log.error(logPrefix + 'Error from driver: ' + err.message);
			cb(err);
		}
	});

	// Remove lock
	tasks.push(cb => {
		this.rmLock(cb);
	});

	return new Promise((resolve, reject) => {
		async.series(tasks, err => {
			if (err) reject(err);
			else resolve();
		});
	});
};

Driver.prototype.runScripts = function runScripts(startVersion, cb) {
	const {migrationScriptPath, log, indexName, url} = this;
	const logPrefix = topLogPrefix + 'runScripts() - indexName: "' + indexName + '" - ';
	const tasks = [];
	const uri = url + '/' + indexName + '/' + indexName + '/1';

	let scriptFound = false;

	log.verbose(logPrefix + 'Started with startVersion: "' + startVersion + '" in path: "' + migrationScriptPath + '" on url: ' + url);

	// Update db_version status
	tasks.push(cb => {
		if (fs.existsSync(migrationScriptPath + '/' + startVersion + '.js')) {
			log.info(logPrefix + 'Found js migration script #' + startVersion + ', running it now.');

			scriptFound = true;

			request.put({url: uri, json: {version: startVersion, status: 'started'}}, (err, response) => {
				if (err) {
					log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);

					return cb(err);
				}

				if (response.statusCode !== 200) {
					const err = new Error('PUT ' + uri + ' statusCode: ' + response.statusCode);

					log.error(logPrefix + err.message);

					return cb(err);
				}

				cb();
			});
		} else {
			cb();
		}
	});

	// Run the script
	tasks.push(async () => {
		if (!scriptFound) return;

		const migration = require(migrationScriptPath + '/' + startVersion + '.js');
		try {
			await migration(this);
		} catch (err) {
			const scriptErr = err;

			log.error(logPrefix + 'Got error running migration script ' + migrationScriptPath + '/' + startVersion + '.js' + ': ' + err.message);

			// Write about the failure in the database
			await new Promise((resolve, reject) => {
				request.put({url: uri, json: {version: startVersion, status: 'failed'}}, (err, response) => {
					if (err) {
						log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);

						return reject(err);
					}

					if (response.statusCode !== 200) {
						const err = new Error('PUT ' + uri + ' statusCode: ' + response.statusCode);

						log.error(logPrefix + err.message);

						return reject(err);
					}

					return resolve(scriptErr);
				});
			});

			// Now we've saved the failure in the database, throw back the script error
			throw scriptErr;
		}

		log.debug(logPrefix + 'Js migration script #' + startVersion + ' ran. Updating database version and moving on.');

		await new Promise((resolve, reject) => {
			request.put({url: uri, json: {version: startVersion, status: 'finnished'}}, (err, response) => {
				if (err) {
					log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);

					return reject(err);
				}

				if (response.statusCode !== 200) {
					const err = new Error('PUT ' + uri + ' statusCode: ' + response.statusCode);

					log.error(logPrefix + err.message);

					return reject(err);
				}

				if (fs.existsSync(migrationScriptPath + '/' + (startVersion + 1) + '.js')) {
					this.runScripts(parseInt(startVersion) + 1, err => {
						if (err) reject(err);
						else resolve();
					});
				} else {
					return resolve();
				}
			});
		});
	});

	async.series(tasks, err => {
		if (err) return cb(err);

		log.info(logPrefix + 'Database migrated and done. Final version is ' + (startVersion - 1));

		// If we end up here, it means there are no more migration scripts to run
		cb();
	});
};

exports = module.exports = Driver;
