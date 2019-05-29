'use strict';

const request = require('request');

// Create index
exports = module.exports = function (options) {
	const esUri = options.url;

	return new Promise((resolve, reject) => {
		request.put(esUri + '/foo', (err, response) => {
			if (err) return reject(err);

			if (response.statusCode !== 200) {
				return reject(new Error('non-200 statusCode: ' + response.statusCode));
			}

			resolve();
		});
	});
};
