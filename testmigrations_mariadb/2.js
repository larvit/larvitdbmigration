'use strict';

exports = module.exports = async options => {
	const {db} = options;
	const migration2Value = options.context.migration2Value;

	await db.query('ALTER TABLE bloj CHANGE nisse hasse int(11);');
	await db.query(`INSERT INTO bloj (hasse) VALUES(${migration2Value});`);
};
