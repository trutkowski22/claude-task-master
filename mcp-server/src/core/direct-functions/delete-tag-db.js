/**
 * delete-tag-db.js
 * Database-powered implementation for deleting a tag
 * 
 * This replaces the file-based delete-tag.js with database operations
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
 * Database-powered tag deletion function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} tagName - Name of the tag to delete
 * @param {Object} options - Tag deletion options
 * @param {boolean} options.yes - Skip confirmation prompts (always true for MCP)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Tag deletion result
 */
async function deleteTagDb(
    userId,
    tagName,
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
            throw new DatabaseError('User ID is required for tag deletion');
        }

        // Validate tag name
        if (!tagName || typeof tagName !== 'string' || tagName.trim().length === 0) {
            throw new DatabaseError('Tag name is required and must be a non-empty string');
        }

        const normalizedTagName = tagName.trim();
        const { yes = true } = options; // For MCP, always skip confirmation

        logFn.info(`Deleting tag: ${normalizedTagName}`);

        // Check if tag exists and get its details
        let tagToDelete;
        try {
            tagToDelete = await db.tags.getByName(userId, normalizedTagName);
            if (!tagToDelete) {
                throw new DatabaseError(`Tag "${normalizedTagName}" not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Tag "${normalizedTagName}" not found: ${error.message}`);
        }

        // Prevent deletion of master/default tag
        if (normalizedTagName.toLowerCase() === 'master' || normalizedTagName.toLowerCase() === 'main' || normalizedTagName.toLowerCase() === 'default') {
            logFn.warn(`Cannot delete protected tag: ${normalizedTagName}`);
            throw new DatabaseError(`Cannot delete protected tag "${normalizedTagName}"`);
        }

        // Get all tasks associated with this tag before deletion
        const tagTasks = await db.tags.getTasksByTag(userId, tagToDelete.id);
        const tasksCount = tagTasks.length;

        logFn.info(`Found ${tasksCount} tasks associated with tag "${normalizedTagName}"`);

        // Check if this is the current active tag (this would need session management in Phase 2)
        let wasCurrentTag = false;
        let switchedToMaster = false;

        // For now, we'll assume it's not the current tag since we don't have session management yet
        // In Phase 2, this will check the user's session for active tag
        logFn.info('Current tag detection not implemented in database version - requires session management');

        // Remove all task-tag associations first
        let tasksDeleted = 0;
        for (const task of tagTasks) {
            try {
                await db.tags.removeFromTask(userId, task.id, tagToDelete.id);
                tasksDeleted++;
            } catch (error) {
                logFn.warn(`Failed to remove tag association from task #${task.task_number}: ${error.message}`);
            }
        }

        // Delete the tag itself
        const deleteResult = await db.tags.delete(userId, tagToDelete.id);
        
        if (!deleteResult) {
            throw new DatabaseError(`Failed to delete tag "${normalizedTagName}"`);
        }

        logFn.info(`Deleted tag: ${normalizedTagName} and removed ${tasksDeleted} task associations`);

        // Log tag deletion in history
        await db.history.log(userId, {
            action: 'tag_deleted',
            changeSummary: `Tag "${normalizedTagName}" deleted`,
            previousValue: {
                tagName: normalizedTagName,
                tagId: tagToDelete.id,
                tasksDeleted,
                wasCurrentTag,
                description: tagToDelete.description
            }
        });

        const successMessage = wasCurrentTag 
            ? `Successfully deleted tag "${normalizedTagName}" and switched to master tag. ${tasksDeleted} task associations removed.`
            : `Successfully deleted tag "${normalizedTagName}". ${tasksDeleted} task associations removed.`;

        logFn.info(successMessage);

        return {
            success: true,
            tagName: normalizedTagName,
            deleted: true,
            tasksDeleted,
            wasCurrentTag,
            switchedToMaster,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error deleting tag: ${error.message}`);
        
        throw new DatabaseError(`Failed to delete tag: ${error.message}`, error.code, {
            tagName,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for deleting tags with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function deleteTagDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        name,
        yes = true, // For MCP, always skip confirmation prompts
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Check required parameters
        if (!name || typeof name !== 'string') {
            mcpLog.error('Missing required parameter: name');
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Tag name is required and must be a string'
                }
            };
        }

        mcpLog.info(`Deleting tag: ${name}, ProjectRoot: ${projectRoot}`);

        // Call the database-powered tag deletion
        const result = await deleteTagDb(
            userId,
            name,
            {
                yes
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
                tagName: result.tagName,
                deleted: result.deleted,
                tasksDeleted: result.tasksDeleted,
                wasCurrentTag: result.wasCurrentTag,
                switchedToMaster: result.switchedToMaster,
                message: result.message
            }
        };

    } catch (error) {
        mcpLog.error(`Error in deleteTagDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'DELETE_TAG_DB_ERROR',
                message: error.message || 'Unknown error deleting tag',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { deleteTagDb };