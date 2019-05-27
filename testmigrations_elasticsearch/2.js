'use strict';

const request = require('request');

// Create document
exports = module.exports = async function (options) {
	const esUri = options.url;

	await new Promise((resolve, reject) => {
		request.put({url: esUri + '/foo/bar/666', json: {blubb: 7}}, (err, response) => {
			if (err) return reject(err);

			if (response.statusCode !== 201) {
				return reject(new Error('non-201 statusCode: ' + response.statusCode));
			}

			resolve();
		});
	});
};
