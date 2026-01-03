import type { IExecuteFunctions } from 'n8n-core';
import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import redis from 'redis';
import crypto from 'crypto';

import util from 'util';

export class Statemachine implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'StateMachine',
		name: 'statemachine',
		icon: 'file:state_machine.svg',
		group: ['input'],
		version: 1,
		description: 'Get, send and update data in Redis',
		defaults: {
			name: 'StateMachine',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				// eslint-disable-next-line
				name: 'redis',
				required: true,
				testedBy: 'redisConnectionTest',
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Check&Store',
						value: 'check_and_store',
						description: 'Check if the value is already stored and if not, store it',
						action: 'Check if the value is already stored and if not store it',
					},
					{
						name: 'Clean',
						value: 'clean',
						description: 'Clean the stored value from the state',
						action: 'Clean the stored value from the state',
					},
					{
						name: 'Error Handling',
						value: 'error_handling',
						description: 'If your workflow has an error, this mode can handle it',
						action: 'If your workflow has an error this mode can handle it',
					},
					{
						name: 'Exists',
						value: 'exists',
						description: 'Check if the value is already stored',
						action: 'Check if the value is already stored',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get the value from the state',
						action: 'Get the value from the state',
					},
					{
						name: 'Purge',
						value: 'purge',
						description: 'Purge the stored value from the state',
						action: 'Purge the stored value from the state',
					},
					{
						name: 'Store (Deprecated)',
						value: 'store',
						description: 'Set the value of you want to store in state',
						action: 'Set the value of you want to store in state',
					},
				],
				default: 'check_and_store',
			},

			// ----------------------------------
			//         store
			// ----------------------------------
			{
				displayName: 'Value',
				name: 'value',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['clean', 'check_and_store', 'exists', 'get'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the key to get from Redis',
			},
			{
				displayName: 'Execution ID',
				name: 'executionId',
				type: 'hidden',
				required: true,
				default: '={{ $execution.id }}',
			},
			{
				displayName: 'Previous Execution ID',
				name: 'previousExecutionId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['error_handling'],
					},
				},
				required: true,
				default: '',
			},
			{
				displayName: 'Global Statement',
				name: 'global',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['store', 'clean', 'purge', 'exists', 'check_and_store', 'get'],
					},
				},
				default: true,
				description: 'Whether to set a global state or just this workflow level',
			},
			{
				displayName: 'Expire',
				name: 'expire',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['check_and_store'],
					},
				},
				default: false,
				description: 'Whether to set a timeout on key',
			},
			{
				displayName: 'TTL',
				name: 'ttl',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						operation: ['store', 'check_and_store'],
						expire: [true],
					},
				},
				default: 86400,
				description: 'Number of seconds before key expiration',
			},
		],
	};

	methods = {
		credentialTest: {
			async redisConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const credentials = credential.data as ICredentialDataDecryptedObject;
				const redisOptions: redis.ClientOpts = {
					host: credentials.host as string,
					port: credentials.port as number,
					db: credentials.database as number,
				};

				if (credentials.password) {
					redisOptions.password = credentials.password as string;
				}
				try {
					const client = redis.createClient(redisOptions);

					await new Promise((resolve, reject): any => {
						client.on('connect', async () => {
							client.ping('ping', (error, pong) => {
								if (error) reject(error);
								resolve(pong);
								client.quit();
							});
						});
						client.on('error', async (err) => {
							client.quit();
							reject(err);
						});
					});
				} catch (error) {
					return {
						status: 'Error',
						message: error.message,
					};
				}
				return {
					status: 'OK',
					message: 'Connection successful!',
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Parses the given value in a number if it is one else returns a string
		async function getValue(client: redis.RedisClient, keyName: string) {
			const clientGet = util.promisify(client.get).bind(client);
			return clientGet(keyName);
		}

		const setValue = async (
			client: redis.RedisClient,
			keyName: string,
			value: string | number | object | string[] | number[],
			expire: boolean,
			ttl: number,
		) => {
			const clientSet = util.promisify(client.set).bind(client);
			await clientSet(keyName, value.toString());

			if (expire) {
				const clientExpire = util.promisify(client.expire).bind(client);
				await clientExpire(keyName, ttl);
			}
			return;
		};

		return new Promise(async (resolve, reject) => {
			const credentials = await this.getCredentials('redis');

			const redisOptions: redis.ClientOpts = {
				host: credentials.host as string,
				port: credentials.port as number,
				db: credentials.database as number,
			};

			if (credentials.password) {
				redisOptions.password = credentials.password as string;
			}

			const client = redis.createClient(redisOptions);
			const operation = this.getNodeParameter('operation', 0);
			const executionId = this.getNodeParameter('executionId', 0);
			client.on('error', (err: Error) => {
				client.quit();
				reject(err);
			});

			client.on('ready', async (_err: Error | null) => {
				client.select(credentials.database as number);
				try {
					const items = this.getInputData();
					const meta = this.getWorkflow();
					const returnItems: INodeExecutionData[] = [];
					let item: INodeExecutionData;
					for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
						item = { json: {} };
						if (operation === 'purge') {
							const global = this.getNodeParameter('global', itemIndex, false) as boolean;
							let key;
							if (global) {
								key = `n8n-state-global-*`;
							} else {
								key = `n8n-state-workflow-${meta.id}-*`;
							}
							const clientDel = util.promisify(client.del).bind(client);
							// @ts-ignore
							const deleted = await clientDel(key);
							item.json.state = deleted > 0;
							returnItems.push(item);
						} else if (operation === 'store' || operation === 'check_and_store' || operation === 'clean' || operation === 'exists' || operation === 'get') {
							const value = this.getNodeParameter('value', itemIndex) as string;
							const global = this.getNodeParameter('global', itemIndex, false) as boolean;
							const hash = crypto.createHash('sha256');
							hash.update(JSON.stringify(value));
							let key;
							if (global) {
								key = `n8n-state-global-*`;
							} else {
								key = `n8n-state-workflow-${meta.id}-${hash.digest('hex')}`;
							}

							if (operation === 'store' || operation === 'check_and_store') {
								const data = (await getValue(client, key)) || null;

								if (data === null) {
									const expire = this.getNodeParameter('expire', itemIndex, false) as boolean;
									const ttl = this.getNodeParameter('ttl', itemIndex, -1) as number;

									await setValue(client, key, value, expire, ttl);
									item.json.state = value;
									const clientPush = util.promisify(client.LPUSH).bind(client);
									// @ts-ignore: typescript not understanding generic function signatures
									await clientPush(`${meta.id}-${executionId}`, key);
									returnItems.push(item);
								} else {
									break;
								}
							} else if (operation === 'clean') {
								const clientDel = util.promisify(client.del).bind(client);
								// @ts-ignore
								await clientDel(key);
							} else if (operation === 'exists') {
								const clientExists = util.promisify(client.exists).bind(client);
								// @ts-ignore
								const exists = await clientExists(key);
								item.json.state = exists > 0;
								returnItems.push(item);
							} else if (operation === 'get') {
								const clientGet = util.promisify(client.get).bind(client);
								// @ts-ignore
								const value = await clientGet(key);
								item.json.state = value;
								returnItems.push(item);
							}
						}

						if (operation === 'error_handling') {
							const previousExecutionId = this.getNodeParameter(
								'previousExecutionId',
								itemIndex,
							) as string;

							const clientLLen = util.promisify(client.LLEN).bind(client);
							const keysRange = await clientLLen(`${meta.id}-${previousExecutionId}`);

							for (let keyIndex = 0; keyIndex < keysRange; keyIndex++) {
								const clientLindex = util.promisify(client.lindex).bind(client);
								const keyName = await clientLindex(`${meta.id}-${previousExecutionId}`, keyIndex);

								const clientDel = util.promisify(client.del).bind(client);
								// @ts-ignore
								await clientDel(keyName);
							}
						}
					}
					client.quit();
					resolve(this.prepareOutputData(returnItems));
				} catch (error) {
					console.log(error);
					reject(error);
				}
			});
		});
	}
}
