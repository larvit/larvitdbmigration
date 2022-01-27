'use strict';

const got = require('got');

// Create index
exports = module.exports = async function (options) {
	const esUri = options.url;
	const getIndexName = options.context.getIndexName;

	await got.put(`${esUri}/${getIndexName()}`);
};
