'use strict';

const got = require('got');

// Create index
exports = module.exports = async function (options) {
	const esUri = options.url;

	await got.put(`${esUri}/foo`);
};
