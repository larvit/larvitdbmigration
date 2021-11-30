'use strict';

const got = require('got');

// Create index
exports = module.exports = async function (options) {
	const esUri = options.eeh.trim(); // Whops, error in script! (For testing purposes)

	await got.put(`${esUri}/foo`);
};
