'use strict';

const	topLogPrefix	= 'larvitdbmigration: dbType/elasticsearch.js - ',
	request	= require('request'),
	async	= require('async'),
	log	= require('winston'),
	fs	= require('fs');

function getLock(retries, cb) {
	const	logPrefix	= topLogPrefix + 'getLock() - indexName: "' + this.options.tableName + '" - ',
		that	= this,
		es	= that.options.dbDriver,
		esUri	= 'http://' + es.transport._config.host;

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	// Source: https://www.elastic.co/guide/en/elasticsearch/guide/current/concurrency-solutions.html
	request({
		'method':	'PUT',
		'uri':	esUri + '/fs/lock/global/_create',
		'body':	'{}'
	}, function (err, response) {
		if (err) {
			log.error(logPrefix + 'Can not get lock on ' + esUri + '/fs/lock/global/_create');
			return cb(err);
		}

		if (response.statusCode !== 201) {
			if (retries < 100) {
				log.info(logPrefix + 'Another process is running the migrations, retry nr: ' + retries + ', wait and try again soon. StatusCode: ' + response.statusCode);
			} else {
				log.warn(logPrefix + 'Another process is running the migrations, retry nr: ' + retries + ', wait and try again soon. StatusCode: ' + response.statusCode);
			}

			setTimeout(function () {
				that.getLock(retries + 1, cb);
			}, 500);
			return;
		}

		log.verbose(logPrefix + 'Locked!');

		cb();
	});
}

function rmLock(cb) {
	const	logPrefix	= topLogPrefix + 'rmLock() - indexName: "' + this.options.tableName + '" - ',
		that	= this,
		es	= that.options.dbDriver,
		esUri	= 'http://' + es.transport._config.host;

	request.delete(esUri + '/fs/lock/global', function (err, response) {
		if (err) {
			log.error(logPrefix + 'Can not clear lock on ' + esUri + '/fs/lock/global');
			return cb(err);
		}

		if (response.statusCode !== 200) {
			const	err	= new Error('Lock could not be removed. StatusCode: ' + response.statusCode);
			log.warn(logPrefix + err.message);
			return cb(err);
		}

		cb();
	});
}

function run(cb) {
	const	logPrefix	= topLogPrefix + 'run() - indexName: "' + this.options.tableName + '" - ',
		indexName	= this.options.tableName,
		tasks	= [],
		that	= this,
		es	= that.options.dbDriver,
		esUri	= 'http://' + es.transport._config.host;

	let	curDoc;

	function getDoc(cb) {
		const	uri	= esUri + '/' + indexName + '/' + indexName + '/1';

		request(uri, function (err, response, body) {
			if (err) {
				log.error(logPrefix + 'getDoc() - GET ' + uri + ' failed, err: ' + err.message);
				return cb(err);
			}

			if (response.statusCode === 200) {
				try {
					curDoc	= JSON.parse(body);
				} catch (err) {
					log.error(logPrefix + 'getDoc() - GET ' + uri + ' invalid JSON in body, err: ' + err.message + ' string: "' + body + '"');
					cb(err);
				}
				return cb(err, response, body);
			}

			cb(err, response, body);
		});
	}

	// Get lock
	tasks.push(function (cb) {
		that.getLock(cb);
	});

	// Create index if it does not exist
	tasks.push(function (cb) {
		const	uri	= esUri + '/' + indexName;

		request.head(uri, function (err, response) {
			if (err) {
				log.error(logPrefix + 'HEAD ' + uri + ' failed, err: ' + err.message);
				return cb(err);
			}

			if (response.statusCode === 200) {
				return cb();
			} else if (response.statusCode !== 404) {
				const	err	= new Error('HEAD ' + uri + ' unexpected statusCode: ' + response.statusCode);
				log.error(logPrefix + err.message);
				return cb(err);
			}

			// If we arrive here its a 404 - create it!
			request.put(uri, function (err, response) {
				if (err) {
					log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);
					return cb(err);
				}

				if (response.statusCode !== 200) {
					const	err	= new Error('PUT ' + uri + ', Unexpected statusCode: ' + response.statusCode);
					log.error(logPrefix + err.message);
					return cb(err);
				}

				cb();
			});
		});
	});

	// Create document if it does not exist and get current document
	tasks.push(function (cb) {
		const	uri	= esUri + '/' + indexName + '/' + indexName + '/1';

		getDoc(function (err, response) {
			if (err) return cb(err);

			if (response.statusCode === 404) {
				request.put({'url': uri, 'json': {'version': 0, 'status': 'finnished'}}, function (err, response) {
					if (err) {
						log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);
						return cb(err);
					}

					if (response.statusCode !== 201) {
						const	err	= new Error('Failed to create document, statusCode: ' + response.statusCode);
						log.error(logPrefix + err.message);
						return cb(err);
					}

					getDoc(cb);
				});
			}
		});
	});

	// Run scripts
	tasks.push(function (cb) {
		try {
			that.runScripts(curDoc._source.version + 1, cb);
		} catch (err) {
			log.error(logPrefix + 'Error from driver: ' + err.message);
			cb(err);
		}
	});

	// Remove lock
	tasks.push(function (cb) {
		that.rmLock(cb);
	});

	async.series(tasks, cb);
};

function runScripts(startVersion, cb) {
	const	migrationScriptsPath	= this.options.migrationScriptsPath,
		indexName	= this.options.tableName,
		logPrefix	= topLogPrefix + 'runScripts() - indexName: "' + this.options.tableName + '" - ',
		tasks	= [],
		that	= this,
		es	= this.options.dbDriver,
		esUri	= 'http://' + es.transport._config.host,
		uri	= esUri + '/' + indexName + '/' + indexName + '/1';

	log.verbose(logPrefix + 'Started with startVersion: "' + startVersion + '" in path: "' + migrationScriptsPath + '" on esUri: ' + esUri);

	// Update db_version status
	tasks.push(function (cb) {
		request.put({'url': uri, 'json': {'version': startVersion, 'status': 'started'}}, function (err, response) {
			if (err) {
				log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);
				return cb(err);
			}

			if (response.statusCode !== 200) {
				const	err	= new Error('PUT ' + uri + ' statusCode: ' + response.statusCode);
				log.error(logPrefix + err.message);
				return cb(err);
			}

			cb();
		});
	});

	// Run the script
	tasks.push(function (cb) {
		if (fs.existsSync(migrationScriptsPath + '/' + startVersion + '.js')) {
			log.info(logPrefix + 'Found js migration script #' + startVersion + ', running it now.');

			try {
				require(migrationScriptsPath + '/' + startVersion + '.js').apply(that, [function (err) {
					if (err) {
						const	scriptErr	= err;

						log.error(logPrefix + 'Got error running migration script ' + migrationScriptsPath + '/' + startVersion + '.js' + ': ' + err.message);

						request.put({'url': uri, 'json': {'version': startVersion, 'status': 'failed'}}, function (err, response) {
							if (err) {
								log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);
								return cb(err);
							}

							if (response.statusCode !== 200) {
								const	err	= new Error('PUT ' + uri + ' statusCode: ' + response.statusCode);
								log.error(logPrefix + err.message);
								return cb(err);
							}

							cb(scriptErr);
						});
					}

					log.debug(logPrefix + 'Js migration script #' + startVersion + ' ran. Updating database version and moving on.');

					request.put({'url': uri, 'json': {'version': startVersion, 'status': 'finnished'}}, function (err, response) {
						if (err) {
							log.error(logPrefix + 'PUT ' + uri + ' failed, err: ' + err.message);
							return cb(err);
						}

						if (response.statusCode !== 200) {
							const	err	= new Error('PUT ' + uri + ' statusCode: ' + response.statusCode);
							log.error(logPrefix + err.message);
							return cb(err);
						}

						if (fs.existsSync(migrationScriptsPath + '/' + (startVersion + 1) + '.js')) {
							that.runScripts(parseInt(startVersion) + 1, cb);
						} else {
							cb();
						}
					});
				}]);
			} catch (err) {
				log.error(logPrefix + 'Uncaught error: ' + err.message);
				cb(err);
			}
		}
	});

	async.series(tasks, function (err) {
		if (err) return cb(err);

		log.info(logPrefix + 'Database migrated and done. Final version is ' + (startVersion - 1));

		// If we end up here, it means there are no more migration scripts to run
		cb();
	});
}

exports.getLock	= getLock;
exports.rmLock	= rmLock;
exports.run	= run;
exports.runScripts	= runScripts;
