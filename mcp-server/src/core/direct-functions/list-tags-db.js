/**
 * list-tags-db.js
 * Database-powered implementation for listing all tags
 * 
 * This replaces the file-based list-tags.js with database operations
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
 * Database-powered tag listing function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} options - Tag listing options
 * @param {boolean} options.showMetadata - Whether to include metadata in the output
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Tag listing result
 */
async function listTagsDb(
    userId,
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
            throw new DatabaseError('User ID is required for listing tags');
        }

        const { showMetadata = false } = options;

        logFn.info('Listing all tags from database');

        // Get all tags for the user
        const userTags = await db.tags.getAll(userId);
        
        if (!userTags || userTags.length === 0) {
            logFn.info('No tags found for user');
            return {
                success: true,
                tags: [],
                currentTag: null,
                totalTags: 0,
                message: 'No tags found'
            };
        }

        logFn.info(`Found ${userTags.length} tags for user`);

        // Get the current active tag (this would require session management in Phase 2)
        let currentTagName = null;
        // For now, we'll assume no current tag since we don't have session management
        // In Phase 2, this will check the user's session for active tag

        // Process each tag to get task information and statistics
        const tagsWithDetails = await Promise.all(userTags.map(async (tag) => {
            try {
                // Get all tasks for this tag
                const tagTasks = await db.tags.getTasksByTag(userId, tag.id);

                // Calculate status breakdown
                const statusBreakdown = tagTasks.reduce((acc, task) => {
                    const status = task.status || 'pending';
                    acc[status] = (acc[status] || 0) + 1;
                    return acc;
                }, {});

                // Calculate completed tasks count
                const completedTasks = statusBreakdown.done || 0;

                // Calculate subtask counts
                const subtaskCounts = tagTasks.reduce(
                    (acc, task) => {
                        if (task.subtasks && task.subtasks.length > 0) {
                            acc.totalSubtasks += task.subtasks.length;
                            task.subtasks.forEach((subtask) => {
                                const subStatus = subtask.status || 'pending';
                                acc.subtasksByStatus[subStatus] =
                                    (acc.subtasksByStatus[subStatus] || 0) + 1;
                            });
                        }
                        return acc;
                    },
                    { totalSubtasks: 0, subtasksByStatus: {} }
                );

                const tagDetails = {
                    name: tag.name,
                    isCurrent: tag.name === currentTagName,
                    taskCount: tagTasks.length,
                    completedTasks,
                    statusBreakdown,
                    subtaskCounts,
                    created: tag.created_at || new Date().toISOString(),
                    description: tag.description || `Tag: ${tag.name}`
                };

                // Include metadata if requested
                if (showMetadata && tag.metadata) {
                    tagDetails.metadata = tag.metadata;
                }

                return tagDetails;
            } catch (error) {
                logFn.warn(`Error processing tag "${tag.name}": ${error.message}`);
                // Return basic info if task processing fails
                return {
                    name: tag.name,
                    isCurrent: tag.name === currentTagName,
                    taskCount: 0,
                    completedTasks: 0,
                    statusBreakdown: {},
                    subtaskCounts: { totalSubtasks: 0, subtasksByStatus: {} },
                    created: tag.created_at || new Date().toISOString(),
                    description: tag.description || `Tag: ${tag.name}`,
                    error: `Failed to load task details: ${error.message}`
                };
            }
        }));

        // Sort tags by name for consistent output
        tagsWithDetails.sort((a, b) => a.name.localeCompare(b.name));

        const totalTags = tagsWithDetails.length;
        const successMessage = `Found ${totalTags} tag(s)`;

        logFn.info(successMessage);

        return {
            success: true,
            tags: tagsWithDetails,
            currentTag: currentTagName,
            totalTags,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error listing tags: ${error.message}`);
        
        throw new DatabaseError(`Failed to list tags: ${error.message}`, error.code, {
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for listing tags with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function listTagsDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        showMetadata = false,
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        mcpLog.info(`Listing all tags, ProjectRoot: ${projectRoot}`);

        // Call the database-powered tag listing
        const result = await listTagsDb(
            userId,
            {
                showMetadata
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
                tags: result.tags,
                currentTag: result.currentTag,
                totalTags: result.totalTags,
                message: result.message
            }
        };

    } catch (error) {
        mcpLog.error(`Error in listTagsDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'LIST_TAGS_DB_ERROR',
                message: error.message || 'Unknown error listing tags',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { listTagsDb };