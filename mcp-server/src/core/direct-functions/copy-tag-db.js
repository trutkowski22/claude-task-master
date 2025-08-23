/**
 * copy-tag-db.js
 * Database-powered implementation for copying a tag
 * 
 * This replaces the file-based copy-tag.js with database operations
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
 * Database-powered tag copying function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} sourceName - Name of the source tag to copy from
 * @param {string} targetName - Name of the new tag to create
 * @param {Object} options - Tag copying options
 * @param {string} options.description - Tag description
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Tag copying result
 */
async function copyTagDb(
    userId,
    sourceName,
    targetName,
    options = {},
    projectId = null,
    context = {}
) {
    const { mcpLog } = context;
    const isMCP = !!mcpLog;

    // Create a consistent logFn object regardless of context
    const logFn = isMCP
        ? mcpLog
        : {
            info: (msg) => console.log(`[INFO] ${msg}`),
            warn: (msg) => console.warn(`[WARN] ${msg}`),
            error: (msg) => console.error(`[ERROR] ${msg}`)
        };

    try {
        // Validate user ID
        if (!userId) {
            throw new DatabaseError('User ID is required for tag copying');
        }

        // Validate source tag name
        if (!sourceName || typeof sourceName !== 'string' || sourceName.trim().length === 0) {
            throw new DatabaseError('Source tag name is required and must be a non-empty string');
        }

        // Validate target tag name
        if (!targetName || typeof targetName !== 'string' || targetName.trim().length === 0) {
            throw new DatabaseError('Target tag name is required and must be a non-empty string');
        }

        const normalizedSourceName = sourceName.trim();
        const normalizedTargetName = targetName.trim();
        const { description } = options;

        logFn.info(`Copying tag from "${normalizedSourceName}" to "${normalizedTargetName}"`);

        // Check if source tag exists
        let sourceTag;
        try {
            sourceTag = await db.tags.getByName(userId, normalizedSourceName);
            if (!sourceTag) {
                throw new DatabaseError(`Source tag "${normalizedSourceName}" not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Source tag "${normalizedSourceName}" not found: ${error.message}`);
        }

        // Check if target tag already exists
        try {
            const existingTargetTag = await db.tags.getByName(userId, normalizedTargetName);
            if (existingTargetTag) {
                throw new DatabaseError(`Target tag "${normalizedTargetName}" already exists`);
            }
        } catch (error) {
            // If tag doesn't exist, that's what we want - continue
            if (error.message.includes('already exists')) {
                throw error;
            }
        }

        // Create the new target tag
        const targetTagData = {
            name: normalizedTargetName,
            description: description || `Copy of ${normalizedSourceName}`,
            metadata: {
                copiedFrom: normalizedSourceName,
                sourceTagId: sourceTag.id,
                originalDescription: sourceTag.description
            }
        };

        const newTargetTag = await db.tags.create(userId, targetTagData);
        logFn.info(`Created target tag: ${normalizedTargetName} with ID: ${newTargetTag.id}`);

        let tasksCopied = 0;

        // Get all tasks associated with the source tag
        const sourceTasks = await db.tags.getTasksByTag(userId, sourceTag.id);
        
        logFn.info(`Found ${sourceTasks.length} tasks in source tag "${normalizedSourceName}"`);

        // Copy tasks to the new target tag
        for (const task of sourceTasks) {
            try {
                await db.tags.addToTask(userId, task.id, newTargetTag.id);
                tasksCopied++;
            } catch (error) {
                logFn.warn(`Failed to copy task #${task.task_number} to target tag: ${error.message}`);
            }
        }

        logFn.info(`Copied ${tasksCopied} tasks from "${normalizedSourceName}" to "${normalizedTargetName}"`);

        // Log tag copying in history
        await db.history.log(userId, {
            action: 'tag_copied',
            changeSummary: `Tag "${normalizedSourceName}" copied to "${normalizedTargetName}"`,
            newValue: {
                sourceName: normalizedSourceName,
                targetName: normalizedTargetName,
                description: newTargetTag.description,
                tasksCopied
            }
        });

        const successMessage = `Successfully copied tag from "${normalizedSourceName}" to "${normalizedTargetName}" with ${tasksCopied} tasks`;

        logFn.info(successMessage);

        return {
            success: true,
            sourceName: normalizedSourceName,
            targetName: normalizedTargetName,
            targetTagId: newTargetTag.id,
            copied: true,
            tasksCopied,
            description: newTargetTag.description,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error copying tag: ${error.message}`);
        
        throw new DatabaseError(`Failed to copy tag: ${error.message}`, error.code, {
            sourceName,
            targetName,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for copying tags with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function copyTagDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        sourceName,
        targetName,
        description,
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Check required parameters
        if (!sourceName || typeof sourceName !== 'string') {
            mcpLog.error('Missing required parameter: sourceName');
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Source tag name is required and must be a string'
                }
            };
        }

        if (!targetName || typeof targetName !== 'string') {
            mcpLog.error('Missing required parameter: targetName');
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Target tag name is required and must be a string'
                }
            };
        }

        mcpLog.info(`Copying tag from "${sourceName}" to "${targetName}", ProjectRoot: ${projectRoot}`);

        // Call the database-powered tag copying
        const result = await copyTagDb(
            userId,
            sourceName,
            targetName,
            {
                description
            },
            null, // projectId - will be handled in Phase 2
            {
                mcpLog,
                session,
                projectRoot
            }
        );

        return {
            success: true,
            data: {
                sourceName: result.sourceName,
                targetName: result.targetName,
                copied: result.copied,
                tasksCopied: result.tasksCopied,
                description: result.description,
                message: result.message
            }
        };

    } catch (error) {
        mcpLog.error(`Error in copyTagDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'COPY_TAG_DB_ERROR',
                message: error.message || 'Unknown error copying tag',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { copyTagDb };