'use strict';

const	request	= require('request');

// Create index
exports = module.exports = function (cb) {
	const	esUri	= 'http://' + this.options.dbDriver.transport._config.host;

	request.put(esUri + '/foo', function (err, response) {
		if (err) throw err;

		if (response.statusCode !== 200) {
			throw new Error('non-200 statusCode: ' + response.statusCode);
		}

		cb();
	});
};
