/**
 * models-db.js
 * Database-powered implementation for AI model configuration management
 *
 * This replaces the file-based models.js with database operations
 */

import { db, DatabaseError } from '../../database/index.js';
import { createLogWrapper } from '../../tools/utils.js';
import { CUSTOM_PROVIDERS_ARRAY } from '../../../../src/constants/providers.js';
import https from 'https';
import http from 'http';

// Constants
const CONFIG_MISSING_ERROR =
	'The configuration file is missing. Run "task-master init" to create it.';

/**
 * Extract user ID from context
 * TODO: Replace with proper JWT token extraction in Phase 2
 */
function getUserId(context = {}) {
	// For now, return a default UUID or generate one for testing
	// In Phase 2, this will extract from JWT token
	if (context.userId && context.userId.length === 36) {
		return context.userId; // Already a UUID
	}

	// Return a default test UUID for migration testing
	return '00000000-0000-0000-0000-000000000001';
}

/**
 * Fetches the list of models from OpenRouter API.
 * @returns {Promise<Array|null>} A promise that resolves with the list of model IDs or null if fetch fails.
 */
function fetchOpenRouterModels() {
	return new Promise((resolve) => {
		const options = {
			hostname: 'openrouter.ai',
			path: '/api/v1/models',
			method: 'GET',
			headers: {
				Accept: 'application/json'
			}
		};

		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});
			res.on('end', () => {
				if (res.statusCode === 200) {
					try {
						const parsedData = JSON.parse(data);
						resolve(parsedData.data || []); // Return the array of models
					} catch (e) {
						console.error('Error parsing OpenRouter response:', e);
						resolve(null); // Indicate failure
					}
				} else {
					console.error(
						`OpenRouter API request failed with status code: ${res.statusCode}`
					);
					resolve(null); // Indicate failure
				}
			});
		});

		req.on('error', (e) => {
			console.error('Error fetching OpenRouter models:', e);
			resolve(null); // Indicate failure
		});
		req.end();
	});
}

/**
 * Fetches the list of models from Ollama instance.
 * @param {string} baseURL - The base URL for the Ollama API (e.g., "http://localhost:11434/api")
 * @returns {Promise<Array|null>} A promise that resolves with the list of model objects or null if fetch fails.
 */
function fetchOllamaModels(baseURL = 'http://localhost:11434/api') {
	return new Promise((resolve) => {
		try {
			// Parse the base URL to extract hostname, port, and base path
			const url = new URL(baseURL);
			const isHttps = url.protocol === 'https:';
			const port = url.port || (isHttps ? 443 : 80);
			const basePath = url.pathname.endsWith('/')
				? url.pathname.slice(0, -1)
				: url.pathname;

			const options = {
				hostname: url.hostname,
				port: parseInt(port, 10),
				path: `${basePath}/tags`,
				method: 'GET',
				headers: {
					Accept: 'application/json'
				}
			};

			const requestLib = isHttps ? https : http;
			const req = requestLib.request(options, (res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					if (res.statusCode === 200) {
						try {
							const parsedData = JSON.parse(data);
							resolve(parsedData.models || []); // Return the array of models
						} catch (e) {
							console.error('Error parsing Ollama response:', e);
							resolve(null); // Indicate failure
						}
					} else {
						console.error(
							`Ollama API request failed with status code: ${res.statusCode}`
						);
						resolve(null); // Indicate failure
					}
				});
			});

			req.on('error', (e) => {
				console.error('Error fetching Ollama models:', e);
				resolve(null); // Indicate failure
			});
			req.end();
		} catch (e) {
			console.error('Error parsing Ollama base URL:', e);
			resolve(null); // Indicate failure
		}
	});
}

/**
 * Database-powered function to get model configuration
 * @param {Object} [options] - Options for the operation
 * @param {Object} [options.session] - Session object containing environment variables (for MCP)
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with current model configuration
 */
async function getModelConfiguration(options = {}) {
	const { mcpLog, projectRoot, session } = options;

	const report = (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};

	const userId = getUserId({ session });

	try {
		// Get user's projects to find the current project
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			throw new DatabaseError('No projects found for user. Please initialize a project first.');
		}

		// For now, use the first project - in Phase 2, this will be determined by context
		const currentProject = projects[0];

		// Get project settings from database
		const projectSettings = currentProject.settings || {};

		// Get AI model settings from project configuration
		const mainProvider = projectSettings.mainProvider || 'anthropic';
		const mainModelId = projectSettings.mainModelId || 'claude-3-5-sonnet-20241022';
		const researchProvider = projectSettings.researchProvider || 'anthropic';
		const researchModelId = projectSettings.researchModelId || 'claude-3-5-sonnet-20241022';
		const fallbackProvider = projectSettings.fallbackProvider || 'anthropic';
		const fallbackModelId = projectSettings.fallbackModelId || 'claude-3-5-sonnet-20241022';

		// For now, return basic model configuration
		// In Phase 2, this would include more detailed model information from database
		return {
			success: true,
			data: {
				activeModels: {
					main: {
						provider: mainProvider,
						modelId: mainModelId,
						sweScore: null, // Will be populated in Phase 2
						cost: null, // Will be populated in Phase 2
						keyStatus: {
							cli: true, // Simplified for Phase 1
							mcp: true // Simplified for Phase 1
						}
					},
					research: {
						provider: researchProvider,
						modelId: researchModelId,
						sweScore: null,
						cost: null,
						keyStatus: {
							cli: true,
							mcp: true
						}
					},
					fallback: fallbackProvider
						? {
								provider: fallbackProvider,
								modelId: fallbackModelId,
								sweScore: null,
								cost: null,
								keyStatus: {
									cli: true,
									mcp: true
								}
							}
						: null
				},
				message: 'Successfully retrieved current model configuration from database'
			}
		};
	} catch (error) {
		report('error', `Error getting model configuration: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CONFIG_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Database-powered function to get available models list
 * @param {Object} [options] - Options for the operation
 * @param {Object} [options.session] - Session object containing environment variables (for MCP)
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with available models
 */
async function getAvailableModelsList(options = {}) {
	const { mcpLog, projectRoot } = options;

	const report = (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};

	const userId = getUserId();

	try {
		// For Phase 1, return a basic list of supported models
		// In Phase 2, this would query the database for all supported models
		const supportedModels = [
			{
				provider: 'anthropic',
				modelId: 'claude-3-5-sonnet-20241022',
				sweScore: 95,
				cost: 0.003,
				allowedRoles: ['main', 'research', 'fallback']
			},
			{
				provider: 'anthropic',
				modelId: 'claude-3-haiku-20240307',
				sweScore: 85,
				cost: 0.00025,
				allowedRoles: ['main', 'research', 'fallback']
			},
			{
				provider: 'openai',
				modelId: 'gpt-4o',
				sweScore: 90,
				cost: 0.005,
				allowedRoles: ['main', 'research', 'fallback']
			},
			{
				provider: 'openai',
				modelId: 'gpt-3.5-turbo',
				sweScore: 80,
				cost: 0.0015,
				allowedRoles: ['main', 'fallback']
			}
		];

		return {
			success: true,
			data: {
				models: supportedModels,
				message: `Successfully retrieved ${supportedModels.length} available models`
			}
		};
	} catch (error) {
		report('error', `Error getting available models: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'MODELS_LIST_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Database-powered function to update a specific model in the configuration
 * @param {string} role - The model role to update ('main', 'research', 'fallback')
 * @param {string} modelId - The model ID to set for the role
 * @param {Object} [options] - Options for the operation
 * @param {string} [options.providerHint] - Provider hint if already determined ('openrouter' or 'ollama')
 * @param {Object} [options.session] - Session object containing environment variables (for MCP)
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with result of update operation
 */
async function setModel(role, modelId, options = {}) {
	const { mcpLog, projectRoot, providerHint } = options;

	const report = (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};

	const userId = getUserId();

	// Validate role
	if (!['main', 'research', 'fallback'].includes(role)) {
		return {
			success: false,
			error: {
				code: 'INVALID_ROLE',
				message: `Invalid role: ${role}. Must be one of: main, research, fallback.`
			}
		};
	}

	// Validate model ID
	if (typeof modelId !== 'string' || modelId.trim() === '') {
		return {
			success: false,
			error: {
				code: 'INVALID_MODEL_ID',
				message: `Invalid model ID: ${modelId}. Must be a non-empty string.`
			}
		};
	}

	try {
		// Get user's projects
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			throw new DatabaseError('No projects found for user. Please initialize a project first.');
		}

		// For now, use the first project - in Phase 2, this will be determined by context
		const currentProject = projects[0];

		// Determine provider (simplified for Phase 1)
		let determinedProvider = 'anthropic'; // Default

		// Simple provider determination based on model ID patterns
		if (modelId.includes('gpt')) {
			determinedProvider = 'openai';
		} else if (modelId.includes('claude')) {
			determinedProvider = 'anthropic';
		} else if (modelId.includes('gemini')) {
			determinedProvider = 'google';
		}

		// Use provider hint if provided
		if (providerHint) {
			determinedProvider = providerHint;
		}

		// Update project settings in database
		const currentSettings = currentProject.settings || {};
		const updatedSettings = {
			...currentSettings,
			[`${role}Provider`]: determinedProvider,
			[`${role}ModelId`]: modelId
		};

		await db.projects.update(userId, currentProject.id, {
			settings: updatedSettings
		});

		// Log the change in audit history
		await db.history.log(userId, {
			action: 'model_updated',
			changeSummary: `Updated ${role} model to ${modelId} (${determinedProvider})`,
			projectId: currentProject.id,
			newValue: {
				role,
				provider: determinedProvider,
				modelId
			}
		});

		const successMessage = `Successfully set ${role} model to ${modelId} (Provider: ${determinedProvider})`;
		report('info', successMessage);

		return {
			success: true,
			data: {
				role,
				provider: determinedProvider,
				modelId,
				message: successMessage,
				warning: null // No warnings in Phase 1
			}
		};
	} catch (error) {
		report('error', `Error setting ${role} model: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'SET_MODEL_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Direct function wrapper for models with database operations
 * @param {Object} args - Arguments passed by the MCP tool
 * @param {Object} log - MCP logger
 * @param {Object} context - MCP context (contains session)
 * @returns {Object} Result object with success, data/error fields
 */
export async function modelsDirect(args, log, context = {}) {
	const { session } = context;
	const { projectRoot } = args; // Extract projectRoot from args

	// Create a logger wrapper that the core functions can use
	const mcpLog = createLogWrapper(log);

	log.info(`Executing models_direct with args: ${JSON.stringify(args)}`);
	log.info(`Using project root: ${projectRoot}`);

	try {
		// Check for the listAvailableModels flag
		if (args.listAvailableModels === true) {
			return await getAvailableModelsList({
				session,
				mcpLog,
				projectRoot
			});
		}

		// Handle setting any model role using unified function
		const modelContext = { session, mcpLog, projectRoot };
		const modelSetResult = await handleModelSetting(args, modelContext);
		if (modelSetResult) {
			return modelSetResult;
		}

		// Default action: get current configuration
		return await getModelConfiguration({
			session,
			mcpLog,
			projectRoot
		});
	} catch (error) {
		log.error(`Error in models_direct: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'DIRECT_FUNCTION_ERROR',
				message: error.message,
				details: error.stack
			}
		};
	}
}

/**
 * Handle setting models for different roles
 * @param {Object} args - Arguments containing role-specific model IDs
 * @param {Object} context - Context object with session, mcpLog, projectRoot
 * @returns {Object|null} Result if a model was set, null if no model setting was requested
 */
async function handleModelSetting(args, context) {
	for (const role of ['main', 'research', 'fallback']) {
		const roleKey = `set${role.charAt(0).toUpperCase() + role.slice(1)}`; // setMain, setResearch, setFallback

		if (args[roleKey]) {
			const providerHint = getProviderHint(args);

			return await setModel(role, args[roleKey], {
				...context,
				providerHint
			});
		}
	}
	return null; // No model setting was requested
}

/**
 * Determine provider hint from custom provider flags
 * @param {Object} args - Arguments containing provider flags
 * @returns {string|undefined} Provider hint or undefined if no custom provider flag is set
 */
function getProviderHint(args) {
	return CUSTOM_PROVIDERS_ARRAY.find((provider) => args[provider]);
}

// Export the database-powered functions for use by other modules
export {
	getModelConfiguration,
	getAvailableModelsList,
	setModel
};
