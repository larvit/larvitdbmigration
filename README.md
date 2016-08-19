[![Build Status](https://travis-ci.org/larvit/larvitdbmigration.svg?branch=master)](https://travis-ci.org/larvit/larvitdbmigration) [![Dependencies](https://david-dm.org/larvit/larvitdbmigration.svg)](https://david-dm.org/larvit/larvitdbmigration.svg)

# Database migration tool

This is used to keep track of the database structure, and update it when need be via deploys.

At the moment only MariaDB(/MySQL) is supported.

A table by default called db_version will be created, containing a single integer.

Scripts will be placed by default in process.cwd()/dbmigration/<version>.js

Each migration script will be ran, and the db_version increased, until no more migration scripts exists.

## Usage

### Application startup script

In your application startup script, do something like this:

```javascript
'use strict';

const dbMigration = require('larvitdbmigration');

dbMigration({
	'host':	'127.0.0.1',
	'user':	'foo',
	'password':	'bar',
	'database':	'baz'
})(function(err) {
	if (err) {
		throw err;
	}

	// Now database is migrated and ready for use!
});
```

If larvitdb already is initiated someplace else, you can omit the database config, like this:

```javascript
const	dbMigration	= require('larvitdbmigration'),
	db	= require('larvitdb');

db.setup({
	'host':	'127.0.0.1',
	'user':	'foo',
	'password':	'bar',
	'database':	'baz'
});

dbMigration()(function(err) {
	if (err) {
		throw err;
	}

	// Now database is migrated and ready for use!
});
```

To use custom table name and/or script path, just change

```javascript
dbMigration({
	'host':	'127.0.0.1',
	'user':	'bar',
	'password':	'bar',
	'database':	'bar'
})(function(err) {
```

to

```javascript
dbMigration({
	'host':	'127.0.0.1',
	'user':	'bar',
	'password':	'bar',
	'database':	'bar',
	'tableName':	'db_version',
	'migrationScriptsPath':	'./dbmigration'
})(function(err) {
```

### Example migration scripts

Lets say the current database have a table like this:

```SQL
CREATE TABLE bloj (nisse int(11));
```

And in the next deploy we'd like to change the column name "nisse" to "hasse". For this you can do one of two methods:

#### Javascript

Create the file process.cwd()/migrationScriptsPath/1.js with this content:

```javascript
'use strict';

const db = require('db');

exports = module.exports = function(cb) {
	db.query('ALTER TABLE bloj CHANGE nisse hasse int(11);', cb);
};
```

#### SQL

_IMPORTANT!_ SQL files will be ignored if a .js file exists.

Create the file process.cwd()/migrationScriptsPath/1.sql with this content:

```SQL
ALTER TABLE bloj CHANGE nisse hasse int(11);
```

#### Summary

Tadaaa! Now this gets done once and the version will be bumped to 1. If you then create a script named "2.js" or "2.sql" you might guess what happends. :)
