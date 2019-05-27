'use strict';

exports = module.exports = async function (options) {
	const db = options.db;

	await db.query('DROP FUNCTION IF EXISTS multi_three;');
	await db.query(`CREATE FUNCTION multi_three (x INT) RETURNS INT
DETERMINISTIC
BEGIN
	SET @a=1;
	SET @b=2;
	RETURN (@a + @b) * x;
END
`);
};
