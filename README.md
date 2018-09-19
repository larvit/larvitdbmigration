[![Build Status](https://travis-ci.org/larvit/larvitdbmigration.svg?branch=master)](https://travis-ci.org/larvit/larvitdbmigration) [![Dependencies](https://david-dm.org/larvit/larvitdbmigration.svg)](https://david-dm.org/larvit/larvitdbmigration.svg)

# Database migration tool

This is used to keep track of the database structure, and update it when need be via deploys.

Supported databases:

* MariaDB (and MySQL)
* Elasticsearch

A table/index by default called db_version will be created, containing a single integer.

Scripts will be placed by default in process.cwd()/dbmigration/<version>.js

Each migration script will be ran, and the db_version increased, until no more migration scripts exists.

## Installation

```bash
npm i --save larvitdbmigration
```

## Usage

### Application startup script

In your application startup script, do something like this:

#### MariaDb and MySQL

```javascript
'use strict';

const DbMigration = require('larvitdbmigration');
const options = {};
const winston = require('winston');
const log = winston.createLogger({'transports': [new winston.transports.Console()]});
const db = require('larvitdb');

let dbMigration;

db.setup({
	'host': '127.0.0.1',
	'user': 'foo',
	'password': 'bar',
	'database': 'baz'
});

options.dbType = 'mariadb';
options.dbDriver = db;
options.tableName = 'db_version';	// Optional - used as index name for elasticsearch
options.migrationScriptsPath = './dbmigration';	// Optional
options.log = log;	// Optional, will use log.silly(), log.debug(), log.verbose(), log.info(), log.warn() and log.error() if given.

dbMigration = new DbMigration(options);

dbMigration.run(function (err) {
	if (err) throw err;

	// Now database is migrated and ready for use!
});
```

#### Elasticsearch

```javascript
'use strict';

const DbMigration = require('larvitdbmigration');
const options = {};
const winston = require('winston');
const log = winston.createLogger({'transports': [new winston.transports.Console()]});

let dbMigration;

options.dbType = 'elasticsearch';
options.url = 'http://127.0.0.1:9200';
options.indexName = 'db_version'; // Optional
options.migrationScriptsPath = './dbmigration';	// Optional
options.log = log;	// Optional, will use log.silly(), log.debug(), log.verbose(), log.info(), log.warn() and log.error() if given.

dbMigration = new DbMigration(options);

dbMigration.run(function (err) {
	if (err) throw err;

	// Now database is migrated and ready for use!
});
```

### Example migration scripts

Lets say the current database have a table like this:

```SQL
CREATE TABLE bloj (nisse int(11));
```

And in the next deploy we'd like to change the column name "nisse" to "hasse". For this you can do one of two methods:

#### MariaDB / MySQL, Javascript

Create the file process.cwd()/migrationScriptsPath/1.js with this content:

```javascript
'use strict';

exports = module.exports = function (cb) {
	const db = this.options.dbDriver;

	db.query('ALTER TABLE bloj CHANGE nisse hasse int(11);', cb);
};
```

#### Elasticsearch

Create the file process.cwd()/migrationScriptsPath/1.js with this content:

```javascript
'use strict';

const request = require('request');

exports = module.exports = function (cb) {
	const that = this;

	request({
		'url': that.options.url + '/some_index/_mapping/some_type',
		'json': true,
		'method': 'PUT',
		'body': {
			'properties': {
				'names': {
					'type': 'string',
					'position_increment_gap': 100
				}
			}
		}
	}, cb);
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
