/**
 * generate-task-files.js
 * Database-powered implementation for generating individual task files
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { generateTaskFilesDirect } from './generate-task-files-db.js';

/**
 * Legacy wrapper function to maintain backward compatibility
 * This function now delegates to the database-powered implementation
 *
 * @param {string} tasksPath - Path to the tasks.json file (deprecated - kept for API compatibility)
 * @param {string} outputDir - Output directory for task files
 * @param {Object} options - Additional options (mcpLog for MCP mode, projectRoot, tag)
 * @param {string} [options.projectRoot] - Project root path
 * @param {string} [options.tag] - Tag for the task
 * @param {Object} [options.mcpLog] - MCP logger object
 * @returns {Object|undefined} Result object in MCP mode, undefined in CLI mode
 */
import { generateTaskFilesDb } from './generate-task-files-db.js';

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

function generateTaskFiles(tasksPath, outputDir, options = {}) {
    try {
        const isMcpMode = !!options?.mcpLog;
        const { projectRoot, tag, mcpLog } = options;

        // Validate required parameters
        if (!tag) {
            throw new Error('Tag is required for task file generation');
        }

        if (!outputDir) {
            throw new Error('Output directory is required for task file generation');
        }

        // Extract user ID from context (will be from JWT in Phase 2)
        const userId = getUserId(options);

        // Create logger wrapper for the database function
        const logFn = isMcpMode
            ? mcpLog
            : {
                info: (msg) => console.log(`[INFO] ${msg}`),
                warn: (msg) => console.warn(`[WARN] ${msg}`),
                error: (msg) => console.error(`[ERROR] ${msg}`),
                success: (msg) => console.log(`[SUCCESS] ${msg}`)
            };

        // Call the database-powered implementation
        const result = generateTaskFilesDb(
            userId,
            null, // projectId - can be extended later
            tag,
            outputDir,
            {
                session: options.session,
                mcpLog: logFn
            }
        );

        if (isMcpMode) {
            return {
                success: true,
                count: result.count,
                directory: result.directory
            };
        }

    } catch (error) {
        // Handle error consistently with original function
        if (!options?.mcpLog) {
            // CLI mode - throw error for backward compatibility
            throw new Error(`Error generating task files: ${error.message}`);
        } else {
            // MCP mode - throw the original error
            throw error;
        }
    }
}

export default generateTaskFiles;
