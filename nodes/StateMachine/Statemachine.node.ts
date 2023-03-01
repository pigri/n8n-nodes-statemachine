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
						name: 'Store',
						value: 'store',
						description: 'Set the value of you want to store in state',
						action: 'Set the value of you want to store in state',
					},
				],
				default: 'store',
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
						operation: ['store'],
					},
				},
				default: '',
				required: true,
				description: 'Name of the key to get from Redis',
			},
			{
				displayName: 'Global Statement',
				name: 'global',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['store'],
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
						operation: ['store'],
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
						operation: ['store'],
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
						const value = this.getNodeParameter('value', itemIndex) as string;
						const expire = this.getNodeParameter('expire', itemIndex, false) as boolean;
						const global = this.getNodeParameter('global', itemIndex, false) as boolean;

						const ttl = this.getNodeParameter('ttl', itemIndex, -1) as number;

						const hash = crypto.createHash('sha256');
						hash.update(JSON.stringify(value));
						let key;
						if (global) {
							key = `n8n-state-global-${hash.digest('hex')}`;
						} else {
							key = `n8n-state-workflow-${meta.id}-${hash.digest('hex')}`;
						}

						const data = (await getValue(client, key)) || null;

						if (data === null) {
							await setValue(client, key, value, expire, ttl);
							item.json.state = value;
							returnItems.push(item);
						} else {
							break;
						}
					}
					client.quit();
					resolve(this.prepareOutputData(returnItems));
				} catch (error) {
					reject(error);
				}
			});
		});
	}
}
