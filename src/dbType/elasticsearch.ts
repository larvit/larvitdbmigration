import { LogInstance } from 'larvitutils';
import { Got, HTTPError, Response } from 'got';
import fs from 'fs';

const topLogPrefix = 'larvitdbmigration: dbType/elasticsearch.js:';

export type ElasticsearchDriverOptions = {
	url: string,
	got: Got,
	indexName: string,
	context?: object,
	log: LogInstance
	migrationScriptPath: string,
};

export default class ElasticsearchDriver {
	private options: ElasticsearchDriverOptions;
	private docUri: string;

	/**
	 * Initiate driver
	 *
	 * @param {object} options -
	 * @param {object} options.log -
	 * @param {String} options.indexName -
	 * @param {String} options.esUurl -
	 * @param {String} options.migrationScriptPath -
	 */
	constructor(options: ElasticsearchDriverOptions) {
		for (const option of ['log', 'got', 'indexName', 'url', 'migrationScriptPath']) {
			if (!options[option as keyof ElasticsearchDriverOptions]) {
				/* istanbul ignore next */
				throw new Error('Missing required option "' + option + '"');
			}
		}

		Object.assign(this, options);

		this.options = options;
		this.docUri = `${options.url}/${options.indexName}/_doc/1`;
	}

	private async getDoc(options: {
		throwHttpErrors: boolean
	}): Promise<{ doc: any, response: Response<string> }> {
		const { docUri } = this;
		const { log, got } = this.options;
		const { throwHttpErrors } = options;
		const logPrefix = `${topLogPrefix} getDoc() -`;

		log.debug(`${logPrefix} Running for ${docUri}`);

		let doc;

		try {
			const response = await got(docUri, { throwHttpErrors });

			log.debug(`${logPrefix} GET ${docUri} ${response.statusCode} ${response.statusMessage}`);

			if (response.statusCode === 200) {
				try {
					doc = JSON.parse(response.body);
				} catch (err) {
					const msg = `${err}, body: ${response.body}`;
					throw new Error(msg);
				}
			}

			return { doc, response };
		} catch (_err) {
			const err = _err as Error;
			const message = `GET ${docUri} failed, err: ${err.message}`;

			log.error(`${logPrefix} ${message}`);
			throw new Error(message);
		}
	}

	private async createIndexIfNotExists(): Promise<void> {
		const { indexName, log, got, url } = this.options;
		const logPrefix = `${topLogPrefix} createIndexIfNotExists() - indexName: "${indexName}" -`;
		const uri = `${url}/${indexName}`;

		log.debug(`${logPrefix} Crating index if it did not exist`);

		// Check if index already exists
		try {
			const response = await got.head(uri, { throwHttpErrors: false });

			if (response.statusCode === 200) {
				log.debug(`${logPrefix} Index already exists`);

				return;
			} else if (response.statusCode !== 404) {
				throw new Error(`unexpected statusCode: ${response.statusCode}`);
			}

			log.debug(`${logPrefix} Index does not exist, create it`);
		} catch (_err) {
			const err = _err as Error;

			throw new Error('HEAD ' + uri + ' failed, err: ' + err.message);
		}

		// If we arrive here its a 404 - create it!
		try {
			await got.put(uri);

			log.debug(`${logPrefix} Created!`);
		} catch (_err) {
			const errPrefix = `PUT ${uri} failed, err:`;
			const msg = this.msgFromGotException(_err);

			log.error(`${logPrefix} ${errPrefix} ${msg}`);
			throw new Error(`${errPrefix} ${msg}`);
		}
	}

	private async createDoc(): Promise<void> {
		const { docUri } = this;
		const { log, got } = this.options;
		const logPrefix = `${topLogPrefix} createDoc() -`;

		log.debug(`${logPrefix} Create database version document: ${docUri}`);

		const response = await got.post(docUri, {
			json: { version: 0, status: 'finished' },
			throwHttpErrors: false,
		});

		if (response.statusCode !== 201) {
			const msg = `Failed to create version document, statusCode: ${response.statusCode}, body: ${response.body}`;
			log.error(`${logPrefix} ${msg}`);
			throw new Error(msg);
		}

		log.verbose(`${logPrefix} Database version document created: ${docUri}`);
	}

	private async createDocIfNotExists(): Promise<void> {
		const { indexName, log } = this.options;
		const logPrefix = `${topLogPrefix} createDocIfNotExists() - indexName: "${indexName}" -`;

		const { response } = await this.getDoc({ throwHttpErrors: false });
		if (response.statusCode === 404) {
			await this.createDoc();
		} else if (response.statusCode === 200) {
			log.debug(`${logPrefix} Database version document already exists`);
		} else {
			const msg = `Unexpected statusCode when getting database version document: ${response.statusCode}, body: ${response.body}`;
			log.error(`${logPrefix} ${msg}`);
			throw new Error(msg);
		}
	}

	/**
	 * Run the migrations
	 *
	 * @return {promise} -
	 */
	async run(): Promise<void> {
		const { indexName, log } = this.options;
		const logPrefix = `${topLogPrefix} run() - indexName: "${indexName}" -`;

		log.debug(`${logPrefix} Started`);

		await this.createIndexIfNotExists();
		await this.createDocIfNotExists();
		const { doc } = await this.getDoc({ throwHttpErrors: true });

		await this.runScripts(doc._source.version + 1);
	}

	private async putVersion(doc: {
		version: number,
		status: string
	}): Promise<void> {
		const { docUri } = this;
		const { log, got } = this.options;
		const logPrefix = `${topLogPrefix} putVersion() - version document: "${docUri}" -`;

		log.verbose(`${logPrefix} Putting version document: ${JSON.stringify(doc)}`);

		try {
			await got.put(docUri, { json: doc });
		} catch (_err) {
			const errorPrefix = `PUT ${docUri} failed, err:`;
			const msg = this.msgFromGotException(_err);

			log.error(`${logPrefix} ${errorPrefix} ${msg}`);
			throw new Error(`${errorPrefix} ${msg}`);
		}
	}

	private msgFromGotException(_err: unknown): string {
		let msg = '';
		if (_err instanceof HTTPError) {
			const err = _err as HTTPError;
			msg = `Unexpected statusCode: ${err.response.statusCode}, body: ${err.response.body}`;
		} else if (_err instanceof Error) {
			const err = _err as Error;
			msg = `${err.message}`;
		} else {
			/* istanbul ignore next */
			msg = `${_err}`;
		}

		return msg;
	}

	private async runScript(version: number): Promise<void> {
		const { migrationScriptPath, log, url, context } = this.options;
		const logPrefix = `${topLogPrefix} runScript() - scriptPath: ${migrationScriptPath}, version: ${version} -`;

		log.verbose(`${logPrefix} Running script`);

		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const migration = require(migrationScriptPath + '/' + version + '.js');
		try {
			await migration({ url, log, context });
		} catch (_scriptErr) {
			const scriptErr = _scriptErr as Error;
			const errMsg = `Error when running migration script ${migrationScriptPath}/${version}.js: ${scriptErr.message}`;

			log.error(`${logPrefix} ${errMsg}`);

			// Store failure status in version doc
			await this.putVersion({ version, status: 'failed' });

			throw new Error(errMsg);
		}
	}

	private async runScripts(startVersion: number): Promise<void> {
		const { migrationScriptPath, log, indexName, url } = this.options;
		const logPrefix = `${topLogPrefix} runScripts() - indexName: "${indexName}" -`;

		log.verbose(`${logPrefix} Starting with startVersion: "${startVersion}" in path: "${migrationScriptPath}" on url: ${url}`);

		let version = startVersion;

		while (true) {
			// Check if migration script version exists
			if (!fs.existsSync(migrationScriptPath + '/' + version + '.js')) {
				log.verbose(`${logPrefix} Could not find script with version: "${version}" in path: "${migrationScriptPath}`);
				break;
			}
			log.info(`${logPrefix} Found js migration script #${version}, running it now.`);

			// Update version document
			await this.putVersion({ version: version, status: 'started' });

			// Run the script
			await this.runScript(version);
			log.debug(`${logPrefix} Js migration script #${version} ran. Updating database version and moving on.`);

			// Update status to 'finished' in version document
			await this.putVersion({ version: version, status: 'finished' });

			// Next version to check for
			version = version + 1;
		}

		log.info(`${logPrefix} Database migrated and done. Final version is ${version - 1}`);
	}
}
