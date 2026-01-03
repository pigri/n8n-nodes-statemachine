import type {
	IExecuteFunctions,
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { createClient } from 'redis';
import crypto from 'crypto';

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
				const redisOptions: Parameters<typeof createClient>[0] = {
					socket: {
						host: credentials.host as string,
						port: credentials.port as number,
					},
					database: credentials.database as number,
				};

				if (credentials.password) {
					redisOptions.password = credentials.password as string;
				}
				try {
					const client = createClient(redisOptions);
					await client.connect();
					await client.ping();
					await client.quit();
				} catch (error: unknown) {
					return {
						status: 'Error',
						message: error instanceof Error ? error.message : String(error),
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
		async function getValue(client: ReturnType<typeof createClient>, keyName: string) {
			return await client.get(keyName);
		}

		const setValue = async (
			client: ReturnType<typeof createClient>,
			keyName: string,
			value: string | number | object | string[] | number[],
			expire: boolean,
			ttl: number,
		) => {
			if (expire) {
				await client.setEx(keyName, ttl, value.toString());
			} else {
				await client.set(keyName, value.toString());
			}
		};

		const credentials = await this.getCredentials('redis');

		const redisOptions: Parameters<typeof createClient>[0] = {
			socket: {
				host: credentials.host as string,
				port: credentials.port as number,
			},
			database: credentials.database as number,
		};

		if (credentials.password) {
			redisOptions.password = credentials.password as string;
		}

		const client = createClient(redisOptions);
		const operation = this.getNodeParameter('operation', 0);
		const executionId = this.getNodeParameter('executionId', 0);

		try {
			await client.connect();

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
					const deleted = await client.del(key);
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
						const data = (await getValue(client, key)) as string | null;

						if (data === null) {
							const expire = this.getNodeParameter('expire', itemIndex, false) as boolean;
							const ttl = this.getNodeParameter('ttl', itemIndex, -1) as number;

							await setValue(client, key, value, expire, ttl);
							item.json.state = value;
							await client.lPush(`${meta.id}-${executionId}`, key);
							returnItems.push(item);
						} else if ( operation === 'check_and_store' && data !== null) {
							item.json.state = false;
							returnItems.push(item);
						} else {
							break;
						}
					} else if (operation === 'clean') {
						const deleted = await client.del(key);
						item.json.state = deleted > 0;
						returnItems.push(item);
					} else if (operation === 'exists') {
						const exists = await client.exists(key);
						item.json.state = exists > 0;
						returnItems.push(item);
					} else if (operation === 'get') {
						const value = await client.get(key);
						if (value === null) {
							item.json.state = false;
							returnItems.push(item);
							continue;
						}
						item.json.state = value;
						returnItems.push(item);
					}
				}

				if (operation === 'error_handling') {
					const previousExecutionId = this.getNodeParameter(
						'previousExecutionId',
						itemIndex,
					) as string;

					const keysRange = await client.lLen(`${meta.id}-${previousExecutionId}`);

					for (let keyIndex = 0; keyIndex < keysRange; keyIndex++) {
						const keyName = await client.lIndex(`${meta.id}-${previousExecutionId}`, keyIndex);
						if (keyName) {
							await client.del(keyName);
						}
					}
				}
			}

			await client.quit();
			return [returnItems];
		} catch (error) {
			await client.quit().catch(() => {});
			throw error;
		}
	}
}
