// Import the database-powered implementation
import { responseLanguageDirect as responseLanguageDbDirect } from './response-language-db.js';

/**
 * response-language.js - DEPRECATED FILE-BASED IMPLEMENTATION
 *
 * This file has been migrated to use database operations.
 * All functionality now delegates to the database-powered implementation.
 */

/**
 * Direct function wrapper for response language management
 * This function now delegates to the database-powered implementation
 * @param {Object} args - Arguments passed by the MCP tool
 * @param {Object} log - MCP logger
 * @param {Object} context - MCP context (contains session)
 * @returns {Object} Result object with success, data/error fields
 */
export async function responseLanguageDirect(args, log, context = {}) {
	// Delegate to the database-powered implementation
	return responseLanguageDbDirect(args, log, context);
}
