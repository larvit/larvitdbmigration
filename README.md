[![Build Status](https://travis-ci.org/larvit/larvitdbmigration.svg?branch=master)](https://travis-ci.org/larvit/larvitdbmigration) [![Dependencies](https://david-dm.org/larvit/larvitdbmigration.svg)](https://david-dm.org/larvit/larvitdbmigration.svg)

# Database migration tool

This is used to keep track of the database structure, content etc, and update it when need be via deploys.

Supported databases:

* MariaDB (and MySQL)
* Elasticsearch

A table/index by default called db_version will be created, containing a single integer.

Scripts will be placed by default in process.cwd()/dbmigration/<version>.js

Each migration script will be ran, and the db_version increased, until no more migration scripts exists.

## Installation

    npm i larvitdbmigration

## Usage

### Application startup script

In your application startup script, do something like this:

#### MariaDb and MySQL

```javascript
'use strict';

const DbMigration = require('larvitdbmigration');
const Db = require('larvitdb');
const dbDriver = new Db({
	host: '127.0.0.1',
	user: 'foo',
	password: 'bar',
	database: 'baz'
});
const dbMigration = new DbMigration({
	dbType: 'mariadb',
	dbDriver,
	tableName: 'db_version', // Optional - used as index name for elasticsearch
	migrationScriptPath: './dbmigration', // Optional
	log // Optional, will use log.silly(), log.debug(), log.verbose(), log.info(), log.warn() and log.error() if given.
});

dbMigration.run().then(() => {
	// Now database is migrated and ready for use!
}).catch(err => {
	throw err;
});
```

#### Elasticsearch

```javascript
'use strict';

const DbMigration = require('larvitdbmigration');
const dbMigration = new DbMigration({
	dbType: 'elasticsearch',
	url: 'http://127.0.0.1:9200',
	indexName: 'db_version', // Optional
	migrationScriptPath: './dbmigration', // Optional
	axios // Optional, will use default axios instance if not specified.
	log // Optional, will use log.silly(), log.debug(), log.verbose(), log.info(), log.warn() and log.error() if given.
});

dbMigration.run().then(() => {
	// Now database is migrated and ready for use!
}).catch(err => {
	throw err;
});
```

### Example migration scripts

Lets say the current database have a table like this:

```SQL
CREATE TABLE bloj (nisse int(11));
```

And in the next deploy we'd like to change the column name "nisse" to "hasse". For this you can do one of two methods:

#### MariaDB / MySQL, Javascript

Create the file process.cwd()/migrationScriptPath/1.js with this content:

```javascript
'use strict';

// Always make the function async (or explicitly return a promise, see elasticsearch example below)
exports = module.exports = async function (options) {
	const {db} = options;

	await db.query('ALTER TABLE bloj CHANGE nisse hasse int(11);');
};
```

#### Elasticsearch

Create the file process.cwd()/migrationScriptPath/1.js with this content:

```javascript
'use strict';

const axios = require('axios');

exports = module.exports = async function (options) {
	const {url, log} = options;

	log.info('Some script-specific logging');

	await axios.put(`${url}/some_index/_mapping`, {
		properties: {
			names: {
				type: 'string',
				position_increment_gap: 100
			}
		}
	});
};
```

#### SQL

_IMPORTANT!_ SQL files will be ignored if a .js file exists.

Create the file process.cwd()/migrationScriptPath/1.sql with this content:

```SQL
ALTER TABLE bloj CHANGE nisse hasse int(11);
```

#### Summary

Tadaaa! Now this gets done once and the version will be bumped to 1. If you then create a script named "2.js" or "2.sql" you might guess what happends. :)

## Changelog
### 7.0.0
* Replaced got with axios (latest versions of got required ES modules and adopters of this lib is not quite ready for it).

### 6.0.0
* Removed locking mechanism for Elasticsearch migrations, there is no support for it in Elasticsearch.
* Rewrote library in TypeScript.
* Updated all dependencies to latest version (and replaced request with got).
* The Elasticsearch driver now only sends url and log instance to the running migration script (instead of the driver instance as it were before).