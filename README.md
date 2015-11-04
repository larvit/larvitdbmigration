# Database migration tool

This is used to keep track of the database structure, and update it when need be via deploys.

At the moment only MariaDB(/MySQL) is supported.

A table by default called db_version will be created, containing a single integer.

Scripts will be placed by default in <application root>/dbmigration/<version>.js

Each migration script will be ran, and the db_version increased, until no more migration scripts exists.

## Usage

### Application startup script

In your application startup script, do something like this:

    'use strict';

    var dbMigration = require('larvitdbmigration');

    dbMigration({'host': '127.0.0.1', 'user': 'bar', 'database': 'bar'})(function(err) {
    	if (err)
    		throw err;

    	// Now database is migrated and ready for use!
    });

To use custom table name and/or script path, just change

    	dbMigration({'host': '127.0.0.1', 'user': 'bar', 'database': 'bar'})(function(err) {

to

    	dbMigration({'host': '127.0.0.1', 'user': 'bar', 'database': 'bar', 'tableName': 'some_table', 'migrationScriptsPath': './scripts_yo'})(function(err) {

### Example migration script

Lets say the current database have a table like this:

    CREATE TABLE bloj (nisse int(11));

And in the next deploy we'd like to change the column name "nisse" to "hasse". Then create the file <application root>/dbmigration/1.js with this content:

    'use strict';

    var db = require('db');

    exports = module.exports = function(cb) {
    	db.query('ALTER TABLE bloj CHANGE nisse hasse int(11);', cb);
    }

Tadaaa! Now this gets done once and the version will be bumped to 1. If you then create a script named "2.js" you might guess what happends. :)
