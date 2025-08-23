// Import the database-powered implementation
import { initializeProjectDirect as initializeProjectDbDirect } from './initialize-project-db.js';

/**
 * initialize-project.js - DEPRECATED FILE-BASED IMPLEMENTATION
 *
 * This file has been migrated to use database operations.
 * All functionality now delegates to the database-powered implementation.
 */

/**
 * Core initialization logic extracted from CLI
 * This function now delegates to the database-powered implementation
 * Derives target directory from session, sets CWD, and calls core init logic.
 * @param {object} args - Arguments containing initialization options (addAliases, initGit, storeTasksInGit, skipInstall, yes, projectRoot, rules)
 * @param {object} log - The FastMCP logger instance.
 * @param {object} context - The context object, must contain { session }.
 * @returns {Promise<{success: boolean, data?: any, error?: {code: string, message: string}}>} - Standard result object.
 */
export async function initializeProjectDirect(args, log, context = {}) {
	// Delegate to the database-powered implementation
	return initializeProjectDbDirect(args, log, context);
}
