'use strict';

const axios = require('axios');

// Create document
exports = module.exports = async function (options) {
	const esUri = options.url;

	await axios.post(`${esUri}/foo/_create/666`, {
		blubb: 7,
	});
};
