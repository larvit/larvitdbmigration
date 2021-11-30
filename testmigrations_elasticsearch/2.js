'use strict';

const got = require('got');

// Create document
exports = module.exports = async function (options) {
	const esUri = options.url;

	await got.post(`${esUri}/foo/_create/666`, {
		json: { blubb: 7 }
	});
};
