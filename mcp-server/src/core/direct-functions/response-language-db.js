/**
 * response-language-db.js
 * Database-powered implementation for response language configuration
 *
 * This replaces the file-based response-language.js with database operations
 */

import { db, DatabaseError } from '../../database/index.js';
import { createLogWrapper } from '../../tools/utils.js';

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
 * Database-powered function to set response language
 * @param {string} language - The language to set for responses
 * @param {Object} [options] - Options for the operation
 * @param {Object} [options.session] - Session object containing environment variables (for MCP)
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with result of language update
 */
async function setResponseLanguage(language, options = {}) {
	const { mcpLog, projectRoot, session } = options;

	const report = (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};

	const userId = getUserId({ session });

	// Validate language input
	if (typeof language !== 'string' || language.trim() === '') {
		return {
			success: false,
			error: {
				code: 'INVALID_RESPONSE_LANGUAGE',
				message: `Invalid response language: ${language}. Must be a non-empty string.`
			}
		};
	}

	try {
		// Get user's projects to find the current project
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			throw new DatabaseError('No projects found for user. Please initialize a project first.');
		}

		// For now, use the first project - in Phase 2, this will be determined by context
		const currentProject = projects[0];

		// Update project settings with the new response language
		const currentSettings = currentProject.settings || {};
		const updatedSettings = {
			...currentSettings,
			responseLanguage: language.trim()
		};

		await db.projects.update(userId, currentProject.id, {
			settings: updatedSettings
		});

		// Log the change in audit history
		await db.history.log(userId, {
			action: 'response_language_updated',
			changeSummary: `Updated response language to: ${language}`,
			projectId: currentProject.id,
			newValue: {
				responseLanguage: language.trim()
			},
			oldValue: {
				responseLanguage: currentSettings.responseLanguage || null
			}
		});

		const successMessage = `Successfully set response language to: ${language}`;
		report('info', successMessage);

		return {
			success: true,
			data: {
				responseLanguage: language.trim(),
				message: successMessage
			}
		};

	} catch (error) {
		report('error', `Error setting response language: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'SET_RESPONSE_LANGUAGE_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Database-powered function to get current response language
 * @param {Object} [options] - Options for the operation
 * @param {Object} [options.session] - Session object containing environment variables (for MCP)
 * @param {Function} [options.mcpLog] - MCP logger object (for MCP)
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {Object} RESTful response with current response language
 */
async function getResponseLanguage(options = {}) {
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

		// Get response language from project settings
		const currentSettings = currentProject.settings || {};
		const responseLanguage = currentSettings.responseLanguage || 'en'; // Default to English

		return {
			success: true,
			data: {
				responseLanguage,
				message: 'Successfully retrieved current response language'
			}
		};

	} catch (error) {
		report('error', `Error getting response language: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'GET_RESPONSE_LANGUAGE_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Direct function wrapper for response language with database operations
 * @param {Object} args - Arguments passed by the MCP tool
 * @param {Object} log - MCP logger
 * @param {Object} context - MCP context (contains session)
 * @returns {Object} Result object with success, data/error fields
 */
export async function responseLanguageDirect(args, log, context = {}) {
	const { session } = context;
	const { projectRoot, language } = args; // Extract projectRoot and language from args

	// Create a logger wrapper that the core functions can use
	const mcpLog = createLogWrapper(log);

	log.info(`Executing response-language_direct with args: ${JSON.stringify(args)}`);
	log.info(`Using project root: ${projectRoot}`);

	try {
		// If language is provided, set it; otherwise, get current language
		if (language) {
			return await setResponseLanguage(language, {
				session,
				mcpLog,
				projectRoot
			});
		} else {
			return await getResponseLanguage({
				session,
				mcpLog,
				projectRoot
			});
		}

	} catch (error) {
		log.error(`Error in responseLanguageDirect: ${error.message}`);
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

// Export the database-powered functions for use by other modules
export {
	setResponseLanguage,
	getResponseLanguage
};
