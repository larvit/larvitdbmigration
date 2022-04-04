'use strict';

const axios = require('axios');

// Create index
exports = module.exports = async function (options) {
	const esUri = options.url;
	const getIndexName = options.context.getIndexName;

	await axios.put(`${esUri}/${getIndexName()}`);
};
