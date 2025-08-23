// Import the database-powered implementation
import { modelsDirect as modelsDbDirect } from './models-db.js';

/**
 * models.js - DEPRECATED FILE-BASED IMPLEMENTATION
 *
 * This file has been migrated to use database operations.
 * All functionality now delegates to the database-powered implementation.
 */

/**
 * Get or update model configuration
 * This function now delegates to the database-powered implementation
 * @param {Object} args - Arguments passed by the MCP tool
 * @param {Object} log - MCP logger
 * @param {Object} context - MCP context (contains session)
 * @returns {Object} Result object with success, data/error fields
 */
export async function modelsDirect(args, log, context = {}) {
	// Delegate to the database-powered implementation
	return modelsDbDirect(args, log, context);
}
