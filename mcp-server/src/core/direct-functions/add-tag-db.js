/**
 * add-tag-db.js
 * Database-powered implementation for creating a new tag
 * 
 * This replaces the file-based add-tag.js with database operations
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
 * Get current git branch name
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<string|null>} Branch name or null if not a git repo
 */
async function getCurrentBranch(projectRoot) {
    try {
        // Import git utilities
        const gitUtils = await import('../../../../scripts/modules/utils/git-utils.js');
        
        // Check if we're in a git repository
        if (!(await gitUtils.isGitRepository(projectRoot))) {
            return null;
        }

        // Get current git branch
        return await gitUtils.getCurrentBranch(projectRoot);
    } catch (error) {
        console.warn(`Error getting git branch: ${error.message}`);
        return null;
    }
}

/**
 * Database-powered tag creation function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} tagName - Name of the tag to create
 * @param {Object} options - Tag creation options
 * @param {boolean} options.copyFromCurrent - Copy tasks from current tag
 * @param {string} options.copyFromTag - Specific tag to copy from
 * @param {string} options.description - Tag description
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Tag creation result
 */
async function addTagDb(
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
            throw new DatabaseError('User ID is required for tag creation');
        }

        // Validate tag name
        if (!tagName || typeof tagName !== 'string' || tagName.trim().length === 0) {
            throw new DatabaseError('Tag name is required and must be a non-empty string');
        }

        const normalizedTagName = tagName.trim();
        const { copyFromCurrent = false, copyFromTag, description } = options;

        logFn.info(`Creating new tag: ${normalizedTagName}`);

        // Check if tag already exists
        try {
            const existingTag = await db.tags.getByName(userId, normalizedTagName);
            if (existingTag) {
                throw new DatabaseError(`Tag "${normalizedTagName}" already exists`);
            }
        } catch (error) {
            // If tag doesn't exist, that's what we want - continue
            if (error.message.includes('already exists')) {
                throw error;
            }
        }

        // Create the new tag
        const tagData = {
            name: normalizedTagName,
            description: description || `Tag: ${normalizedTagName}`,
            metadata: {
                createdFrom: copyFromTag ? 'specific_tag' : (copyFromCurrent ? 'current_tag' : 'new'),
                sourceTag: copyFromTag || null
            }
        };

        const newTag = await db.tags.create(userId, tagData);
        logFn.info(`Created new tag: ${normalizedTagName} with ID: ${newTag.id}`);

        let tasksCopied = 0;
        let sourceTag = null;

        // Handle task copying if requested
        if (copyFromCurrent || copyFromTag) {
            let sourceTagName = copyFromTag;
            
            if (copyFromCurrent && !copyFromTag) {
                // Get current active tag (this would require session/context management)
                // For now, we'll skip automatic current tag detection
                logFn.warn('copyFromCurrent is not yet implemented in database version - requires session management');
                sourceTagName = null;
            }

            if (sourceTagName) {
                try {
                    // Get source tag
                    const sourceTagObj = await db.tags.getByName(userId, sourceTagName);
                    if (sourceTagObj) {
                        sourceTag = sourceTagName;
                        
                        // Get all tasks associated with the source tag
                        const sourceTasks = await db.tags.getTasksByTag(userId, sourceTagObj.id);
                        
                        logFn.info(`Found ${sourceTasks.length} tasks in source tag "${sourceTagName}"`);
                        
                        // Copy tasks to the new tag
                        for (const task of sourceTasks) {
                            try {
                                await db.tags.addToTask(userId, task.id, newTag.id);
                                tasksCopied++;
                            } catch (error) {
                                logFn.warn(`Failed to copy task #${task.task_number} to new tag: ${error.message}`);
                            }
                        }

                        logFn.info(`Copied ${tasksCopied} tasks from "${sourceTagName}" to "${normalizedTagName}"`);
                    } else {
                        logFn.warn(`Source tag "${sourceTagName}" not found - creating empty tag`);
                    }
                } catch (error) {
                    logFn.warn(`Error copying tasks from source tag: ${error.message}`);
                }
            }
        }

        // Log tag creation in history
        await db.history.log(userId, {
            action: 'tag_created',
            changeSummary: `Tag "${normalizedTagName}" created`,
            newValue: {
                tagName: normalizedTagName,
                description: description || `Tag: ${normalizedTagName}`,
                tasksCopied,
                sourceTag
            }
        });

        const successMessage = tasksCopied > 0 
            ? `Successfully created tag "${normalizedTagName}" with ${tasksCopied} tasks copied from "${sourceTag}"`
            : `Successfully created tag "${normalizedTagName}"`;

        logFn.info(successMessage);

        return {
            success: true,
            tagName: normalizedTagName,
            tagId: newTag.id,
            created: true,
            tasksCopied,
            sourceTag,
            description: newTag.description,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error creating tag: ${error.message}`);
        
        throw new DatabaseError(`Failed to create tag: ${error.message}`, error.code, {
            tagName,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for creating tags with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function addTagDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        name,
        copyFromCurrent = false,
        copyFromTag,
        fromBranch = false,
        description,
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Handle --from-branch option
        if (fromBranch) {
            mcpLog.info('Creating tag from current git branch');

            // Get current git branch
            const currentBranch = await getCurrentBranch(projectRoot);
            if (!currentBranch) {
                mcpLog.error('Could not determine current git branch or not in a git repository');
                return {
                    success: false,
                    error: {
                        code: 'NO_CURRENT_BRANCH',
                        message: 'Could not determine current git branch or not in a git repository.'
                    }
                };
            }

            // Use the branch name as the tag name
            const branchTagName = currentBranch;
            const branchDescription = description || `Tag created from git branch "${currentBranch}"`;

            // Create tag with branch name
            const result = await addTagDb(
                userId,
                branchTagName,
                {
                    copyFromCurrent,
                    copyFromTag,
                    description: branchDescription
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
                    branchName: currentBranch,
                    tagName: result.tagName,
                    created: result.created,
                    tasksCopied: result.tasksCopied,
                    message: `Successfully created tag "${result.tagName}" from git branch "${currentBranch}"`
                }
            };

        } else {
            // Regular tag creation
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

            mcpLog.info(`Creating new tag: ${name}, ProjectRoot: ${projectRoot}`);

            // Call the database-powered tag creation
            const result = await addTagDb(
                userId,
                name,
                {
                    copyFromCurrent,
                    copyFromTag,
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
                    tagName: result.tagName,
                    created: result.created,
                    tasksCopied: result.tasksCopied,
                    sourceTag: result.sourceTag,
                    description: result.description,
                    message: result.message
                }
            };
        }

    } catch (error) {
        mcpLog.error(`Error in addTagDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'ADD_TAG_DB_ERROR',
                message: error.message || 'Unknown error creating tag',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { addTagDb };