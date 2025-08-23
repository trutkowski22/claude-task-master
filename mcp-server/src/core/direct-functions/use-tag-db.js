/**
 * use-tag-db.js
 * Database-powered implementation for switching to a tag
 * 
 * This replaces the file-based use-tag.js with database operations
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
 * Database-powered tag switching function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} tagName - Name of the tag to switch to
 * @param {Object} options - Tag switching options (reserved for future use)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Tag switching result
 */
async function useTagDb(
    userId,
    tagName,
    options = {},
    projectId = null,
    context = {}
) {
    const { mcpLog, session } = context;
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
            throw new DatabaseError('User ID is required for tag switching');
        }

        // Validate tag name
        if (!tagName || typeof tagName !== 'string' || tagName.trim().length === 0) {
            throw new DatabaseError('Tag name is required and must be a non-empty string');
        }

        const normalizedTagName = tagName.trim();

        logFn.info(`Switching to tag: ${normalizedTagName}`);

        // Check if target tag exists
        let targetTag;
        try {
            targetTag = await db.tags.getByName(userId, normalizedTagName);
            if (!targetTag) {
                throw new DatabaseError(`Tag "${normalizedTagName}" not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Tag "${normalizedTagName}" not found: ${error.message}`);
        }

        // Get the current active tag (this requires session management in Phase 2)
        let previousTag = null;
        let switched = false;

        // For now, we'll store the current tag information in session context if available
        // In Phase 2, this will be handled by proper user session management
        if (session) {
            // Store previous tag info
            previousTag = session.currentTag || null;
            
            // Update current tag in session
            session.currentTag = normalizedTagName;
            session.currentTagId = targetTag.id;
            
            switched = true;
            logFn.info(`Updated session with current tag: ${normalizedTagName}`);
        } else {
            // Without session management, we can't persist the current tag selection
            logFn.warn('No session context available - tag switching requires session management for persistence');
            
            // We'll still report success but note the limitation
            switched = true;
            logFn.info('Tag switching completed but not persisted (requires session management)');
        }

        // Get task count for the target tag
        const tagTasks = await db.tags.getTasksByTag(userId, targetTag.id);
        const taskCount = tagTasks.length;

        logFn.info(`Tag "${normalizedTagName}" has ${taskCount} tasks`);

        // Log tag switch in history
        await db.history.log(userId, {
            action: 'tag_switched',
            changeSummary: `Switched to tag "${normalizedTagName}"`,
            previousValue: {
                previousTag,
                previousTagActive: !!previousTag
            },
            newValue: {
                currentTag: normalizedTagName,
                currentTagId: targetTag.id,
                taskCount,
                switchedAt: new Date().toISOString()
            }
        });

        const successMessage = previousTag 
            ? `Successfully switched from tag "${previousTag}" to "${normalizedTagName}"`
            : `Successfully switched to tag "${normalizedTagName}"`;

        logFn.info(successMessage);

        return {
            success: true,
            currentTag: normalizedTagName,
            switched,
            previousTag,
            taskCount,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error switching to tag: ${error.message}`);
        
        throw new DatabaseError(`Failed to switch to tag: ${error.message}`, error.code, {
            tagName,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for switching to tags with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function useTagDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        name,
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

        mcpLog.info(`Switching to tag: ${name}, ProjectRoot: ${projectRoot}`);

        // Call the database-powered tag switching
        const result = await useTagDb(
            userId,
            name,
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
                tagName: result.currentTag,
                switched: result.switched,
                previousTag: result.previousTag,
                taskCount: result.taskCount,
                message: result.message
            }
        };

    } catch (error) {
        mcpLog.error(`Error in useTagDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'USE_TAG_DB_ERROR',
                message: error.message || 'Unknown error switching to tag',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { useTagDb };