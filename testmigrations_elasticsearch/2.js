'use strict';

const	request	= require('request');

// Create document
exports = module.exports = function (cb) {
	const	esUri	= 'http://' + this.options.dbDriver.transport._config.host;

	request.put({'url': esUri + '/foo/bar/666', 'json': {'blubb': 7}}, function (err, response) {
		if (err) throw err;

		if (response.statusCode !== 201) {
			throw new Error('non-201 statusCode: ' + response.statusCode);
		}

		cb();
	});
};
