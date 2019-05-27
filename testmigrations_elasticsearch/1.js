'use strict';

const request = require('request');

// Create index
exports = module.exports = async function (options) {
	const esUri = options.url;

	await new Promise((resolve, reject) => {
		request.put(esUri + '/foo', (err, response) => {
			if (err) return reject(err);

			if (response.statusCode !== 200) {
				return reject(new Error('non-200 statusCode: ' + response.statusCode));
			}

			resolve();
		});
	});
};
