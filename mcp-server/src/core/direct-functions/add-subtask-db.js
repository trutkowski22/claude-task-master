/**
 * add-subtask-db.js
 * Database-powered implementation for adding subtasks to existing tasks
 * 
 * This replaces the file-based add-subtask.js with database operations
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
 * Validate subtask status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
function isValidSubtaskStatus(status) {
    const validStatuses = ['pending', 'in-progress', 'done', 'review', 'deferred', 'cancelled'];
    return validStatuses.includes(status);
}

/**
 * Database-powered subtask addition function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string|number} parentTaskId - Parent task ID (number)
 * @param {string|number} existingTaskId - Existing task ID to convert to subtask (optional)
 * @param {Object} newSubtaskData - New subtask data (optional)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Subtask creation result
 */
async function addSubtaskDb(
    userId,
    parentTaskId,
    existingTaskId = null,
    newSubtaskData = null,
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
            throw new DatabaseError('User ID is required for subtask creation');
        }

        // Parse parent task ID
        const parentTaskNumber = typeof parentTaskId === 'string' ? parseInt(parentTaskId, 10) : parentTaskId;
        if (Number.isNaN(parentTaskNumber)) {
            throw new DatabaseError(`Invalid parent task ID: ${parentTaskId}`);
        }

        // Get parent task from database
        const parentTask = await db.tasks.getByNumber(userId, parentTaskNumber, projectId);
        if (!parentTask) {
            throw new DatabaseError(`Parent task #${parentTaskNumber} not found`);
        }

        logFn.info(`Adding subtask to parent task #${parentTaskNumber}: ${parentTask.title}`);

        if (existingTaskId) {
            // Case 1: Convert existing task to subtask
            const existingTaskNumber = typeof existingTaskId === 'string' ? parseInt(existingTaskId, 10) : existingTaskId;
            if (Number.isNaN(existingTaskNumber)) {
                throw new DatabaseError(`Invalid existing task ID: ${existingTaskId}`);
            }

            const existingTask = await db.tasks.getByNumber(userId, existingTaskNumber, projectId);
            if (!existingTask) {
                throw new DatabaseError(`Task #${existingTaskNumber} not found for conversion`);
            }

            // Check if task is already a subtask (this would be unusual)
            const existingSubtasks = await db.subtasks.listByTask(userId, existingTask.id);
            if (existingSubtasks.length > 0) {
                throw new DatabaseError(`Task #${existingTaskNumber} already has subtasks and cannot be converted to a subtask`);
            }

            // Get next subtask number for parent task
            const parentSubtasks = await db.subtasks.listByTask(userId, parentTask.id);
            const nextSubtaskNumber = parentSubtasks.length + 1;

            // Create subtask from existing task data
            const subtaskData = {
                taskId: parentTask.id,
                subtaskNumber: nextSubtaskNumber,
                title: existingTask.title,
                description: existingTask.description,
                status: existingTask.status,
                details: existingTask.details || {}
            };

            const newSubtask = await db.subtasks.create(userId, subtaskData);

            // Log the conversion in history
            await db.history.log(userId, {
                taskId: parentTask.id,
                subtaskId: newSubtask.id,
                action: 'converted',
                changeSummary: `Task #${existingTaskNumber} converted to subtask #${parentTaskNumber}.${nextSubtaskNumber}`,
                oldValue: {
                    originalTaskId: existingTaskNumber,
                    originalTitle: existingTask.title
                },
                newValue: {
                    parentTaskId: parentTaskNumber,
                    subtaskId: `${parentTaskNumber}.${nextSubtaskNumber}`,
                    title: existingTask.title
                }
            });

            // Remove the original task (now converted to subtask)
            await db.tasks.delete(userId, existingTask.id);

            logFn.info(`Successfully converted task #${existingTaskNumber} to subtask #${parentTaskNumber}.${nextSubtaskNumber}`);

            return {
                success: true,
                subtask: {
                    id: `${parentTaskNumber}.${nextSubtaskNumber}`,
                    title: newSubtask.title,
                    description: newSubtask.description,
                    status: newSubtask.status,
                    details: newSubtask.details,
                    created_at: newSubtask.created_at,
                    updated_at: newSubtask.updated_at,
                    parentTask: {
                        id: parentTaskNumber,
                        title: parentTask.title,
                        status: parentTask.status
                    }
                },
                action: 'converted',
                message: `Task #${existingTaskNumber} successfully converted to subtask #${parentTaskNumber}.${nextSubtaskNumber}`
            };

        } else if (newSubtaskData) {
            // Case 2: Create new subtask from provided data
            const { title, description, details, status, dependencies } = newSubtaskData;

            // Validate required fields
            if (!title || title.trim().length === 0) {
                throw new DatabaseError('Subtask title is required');
            }

            // Validate status
            const subtaskStatus = status || 'pending';
            if (!isValidSubtaskStatus(subtaskStatus)) {
                throw new DatabaseError(`Invalid subtask status: ${subtaskStatus}. Valid statuses are: pending, in-progress, done, review, deferred, cancelled`);
            }

            // Get next subtask number for parent task
            const parentSubtasks = await db.subtasks.listByTask(userId, parentTask.id);
            const nextSubtaskNumber = parentSubtasks.length + 1;

            // Create new subtask
            const subtaskData = {
                taskId: parentTask.id,
                subtaskNumber: nextSubtaskNumber,
                title: title.trim(),
                description: description || '',
                status: subtaskStatus,
                details: {
                    implementation: details || '',
                    manuallyCreated: true,
                    ...(typeof details === 'object' ? details : {})
                }
            };

            const newSubtask = await db.subtasks.create(userId, subtaskData);

            // Handle dependencies if provided
            if (dependencies && dependencies.length > 0) {
                logFn.info(`Processing ${dependencies.length} dependencies for subtask`);
                // Note: Subtask dependencies would require additional schema design
                // For now, we'll log this as a feature to be implemented
                logFn.warn('Subtask dependencies not yet implemented in database schema');
            }

            // Log the creation in history
            await db.history.log(userId, {
                taskId: parentTask.id,
                subtaskId: newSubtask.id,
                action: 'created',
                changeSummary: `New subtask #${parentTaskNumber}.${nextSubtaskNumber} created: ${title}`,
                newValue: {
                    subtaskId: `${parentTaskNumber}.${nextSubtaskNumber}`,
                    title: title,
                    status: subtaskStatus,
                    parentTaskId: parentTaskNumber
                }
            });

            logFn.info(`Successfully created new subtask #${parentTaskNumber}.${nextSubtaskNumber}: ${title}`);

            return {
                success: true,
                subtask: {
                    id: `${parentTaskNumber}.${nextSubtaskNumber}`,
                    title: newSubtask.title,
                    description: newSubtask.description,
                    status: newSubtask.status,
                    details: newSubtask.details,
                    created_at: newSubtask.created_at,
                    updated_at: newSubtask.updated_at,
                    parentTask: {
                        id: parentTaskNumber,
                        title: parentTask.title,
                        status: parentTask.status
                    }
                },
                action: 'created',
                message: `New subtask #${parentTaskNumber}.${nextSubtaskNumber} successfully created`
            };

        } else {
            throw new DatabaseError('Either existingTaskId or newSubtaskData must be provided');
        }

    } catch (error) {
        logFn.error(`Error adding subtask: ${error.message}`);
        
        throw new DatabaseError(`Failed to add subtask: ${error.message}`, error.code, {
            parentTaskId,
            existingTaskId,
            newSubtaskData: newSubtaskData ? { title: newSubtaskData.title } : null,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for adding subtasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function addSubtaskDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        taskId,
        title,
        description,
        details,
        status,
        dependencies: dependenciesStr,
        skipGenerate,
        projectRoot,
        tag
    } = args;

    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(`Adding subtask with args: ${JSON.stringify(args)}`);

        // Validate required parameters
        if (!id) {
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Parent task ID is required'
                }
            };
        }

        // Either taskId or title must be provided
        if (!taskId && !title) {
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Either taskId or title must be provided'
                }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        // Parse dependencies if provided
        let dependencies = [];
        if (dependenciesStr) {
            dependencies = dependenciesStr.split(',').map((depId) => {
                // Handle both regular IDs and dot notation
                return depId.includes('.') ? depId.trim() : parseInt(depId.trim(), 10);
            });
        }

        // Convert existingTaskId to a number if provided
        const existingTaskId = taskId ? parseInt(taskId, 10) : null;

        // Convert parent ID to a number
        const parentId = parseInt(id, 10);

        logWrapper.info(`Processing subtask for parent task #${parentId}, ProjectRoot: ${projectRoot}`);

        let result;

        if (existingTaskId) {
            // Case 1: Convert existing task to subtask
            logWrapper.info(`Converting task ${existingTaskId} to a subtask of ${parentId}`);
            
            result = await addSubtaskDb(
                userId,
                parentId,
                existingTaskId,
                null,
                null, // projectId - will be handled in Phase 2
                {
                    mcpLog: logWrapper,
                    projectRoot,
                    tag
                }
            );
        } else {
            // Case 2: Create new subtask
            logWrapper.info(`Creating new subtask for parent task ${parentId}`);

            const newSubtaskData = {
                title: title,
                description: description || '',
                details: details || '',
                status: status || 'pending',
                dependencies: dependencies
            };

            result = await addSubtaskDb(
                userId,
                parentId,
                null,
                newSubtaskData,
                null, // projectId - will be handled in Phase 2
                {
                    mcpLog: logWrapper,
                    projectRoot,
                    tag
                }
            );
        }

        logWrapper.info(result.message);

        return {
            success: true,
            data: {
                message: result.message,
                subtask: result.subtask,
                action: result.action
            }
        };

    } catch (error) {
        logWrapper.error(`Error in addSubtaskDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'ADD_SUBTASK_DB_ERROR',
                message: error.message || 'Unknown error adding subtask',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { addSubtaskDb };