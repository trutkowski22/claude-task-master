/**
 * rename-tag-db.js
 * Database-powered implementation for renaming a tag
 * 
 * This replaces the file-based rename-tag.js with database operations
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
 * Database-powered tag renaming function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} oldName - Current name of the tag to rename
 * @param {string} newName - New name for the tag
 * @param {Object} options - Tag renaming options (reserved for future use)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Tag renaming result
 */
async function renameTagDb(
    userId,
    oldName,
    newName,
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
            throw new DatabaseError('User ID is required for tag renaming');
        }

        // Validate old tag name
        if (!oldName || typeof oldName !== 'string' || oldName.trim().length === 0) {
            throw new DatabaseError('Old tag name is required and must be a non-empty string');
        }

        // Validate new tag name
        if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
            throw new DatabaseError('New tag name is required and must be a non-empty string');
        }

        const normalizedOldName = oldName.trim();
        const normalizedNewName = newName.trim();

        // Check if old and new names are the same
        if (normalizedOldName === normalizedNewName) {
            throw new DatabaseError('Old and new tag names cannot be the same');
        }

        logFn.info(`Renaming tag from "${normalizedOldName}" to "${normalizedNewName}"`);

        // Check if old tag exists
        let tagToRename;
        try {
            tagToRename = await db.tags.getByName(userId, normalizedOldName);
            if (!tagToRename) {
                throw new DatabaseError(`Tag "${normalizedOldName}" not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Tag "${normalizedOldName}" not found: ${error.message}`);
        }

        // Check if new tag name already exists
        try {
            const existingNewTag = await db.tags.getByName(userId, normalizedNewName);
            if (existingNewTag) {
                throw new DatabaseError(`Tag "${normalizedNewName}" already exists`);
            }
        } catch (error) {
            // If tag doesn't exist, that's what we want - continue
            if (error.message.includes('already exists')) {
                throw error;
            }
        }

        // Prevent renaming of master/default tag
        if (normalizedOldName.toLowerCase() === 'master' || normalizedOldName.toLowerCase() === 'main' || normalizedOldName.toLowerCase() === 'default') {
            logFn.warn(`Cannot rename protected tag: ${normalizedOldName}`);
            throw new DatabaseError(`Cannot rename protected tag "${normalizedOldName}"`);
        }

        // Get task count for this tag before renaming
        const tagTasks = await db.tags.getTasksByTag(userId, tagToRename.id);
        const taskCount = tagTasks.length;

        logFn.info(`Tag "${normalizedOldName}" has ${taskCount} associated tasks`);

        // Check if this is the current active tag (this would require session management in Phase 2)
        let wasCurrentTag = false;
        // For now, we'll assume it's not the current tag since we don't have session management yet
        // In Phase 2, this will check the user's session for active tag
        logFn.info('Current tag detection not implemented in database version - requires session management');

        // Update the tag metadata to preserve rename history
        const updatedMetadata = {
            ...tagToRename.metadata,
            previousNames: [
                ...(tagToRename.metadata?.previousNames || []),
                {
                    name: normalizedOldName,
                    renamedAt: new Date().toISOString()
                }
            ],
            lastRenamed: new Date().toISOString()
        };

        // Update the tag name in the database
        const updateData = {
            name: normalizedNewName,
            metadata: updatedMetadata
        };

        const updatedTag = await db.tags.update(userId, tagToRename.id, updateData);
        
        if (!updatedTag) {
            throw new DatabaseError(`Failed to rename tag "${normalizedOldName}" to "${normalizedNewName}"`);
        }

        logFn.info(`Successfully renamed tag from "${normalizedOldName}" to "${normalizedNewName}"`);

        // Log tag renaming in history
        await db.history.log(userId, {
            action: 'tag_renamed',
            changeSummary: `Tag renamed from "${normalizedOldName}" to "${normalizedNewName}"`,
            previousValue: {
                name: normalizedOldName,
                description: tagToRename.description,
                metadata: tagToRename.metadata
            },
            newValue: {
                name: normalizedNewName,
                description: updatedTag.description,
                metadata: updatedTag.metadata,
                taskCount,
                wasCurrentTag
            }
        });

        const successMessage = wasCurrentTag 
            ? `Successfully renamed tag from "${normalizedOldName}" to "${normalizedNewName}" (current tag updated)`
            : `Successfully renamed tag from "${normalizedOldName}" to "${normalizedNewName}"`;

        logFn.info(successMessage);

        return {
            success: true,
            oldName: normalizedOldName,
            newName: normalizedNewName,
            renamed: true,
            taskCount,
            wasCurrentTag,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error renaming tag: ${error.message}`);
        
        throw new DatabaseError(`Failed to rename tag: ${error.message}`, error.code, {
            oldName,
            newName,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for renaming tags with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function renameTagDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        oldName,
        newName,
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Check required parameters
        if (!oldName || typeof oldName !== 'string') {
            mcpLog.error('Missing required parameter: oldName');
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Old tag name is required and must be a string'
                }
            };
        }

        if (!newName || typeof newName !== 'string') {
            mcpLog.error('Missing required parameter: newName');
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'New tag name is required and must be a string'
                }
            };
        }

        mcpLog.info(`Renaming tag from "${oldName}" to "${newName}", ProjectRoot: ${projectRoot}`);

        // Call the database-powered tag renaming
        const result = await renameTagDb(
            userId,
            oldName,
            newName,
            {}, // options - reserved for future use
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
                oldName: result.oldName,
                newName: result.newName,
                renamed: result.renamed,
                taskCount: result.taskCount,
                wasCurrentTag: result.wasCurrentTag,
                message: result.message
            }
        };

    } catch (error) {
        mcpLog.error(`Error in renameTagDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'RENAME_TAG_DB_ERROR',
                message: error.message || 'Unknown error renaming tag',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { renameTagDb };