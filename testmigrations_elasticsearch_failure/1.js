'use strict';

const axios = require('axios');

// Create index
exports = module.exports = async function (options) {
	const esUri = options.eeh.trim(); // Whops, error in script! (For testing purposes)

	await axios.put(`${esUri}/foo`);
};
