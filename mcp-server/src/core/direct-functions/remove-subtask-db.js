/**
 * remove-subtask-db.js
 * Database-powered implementation for removing subtasks from parent tasks
 * 
 * This replaces the file-based remove-subtask.js with database operations
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
 * Parse subtask ID in format "5.2"
 * @param {string} subtaskId - Subtask ID in format "parentId.subtaskId"
 * @returns {Object} Parsed subtask ID information
 */
function parseSubtaskId(subtaskId) {
    if (!subtaskId || typeof subtaskId !== 'string' || !subtaskId.includes('.')) {
        throw new DatabaseError(`Invalid subtask ID format: ${subtaskId}. Must be in format "parentId.subtaskId" (e.g., "5.2").`);
    }

    const [parentTaskNumber, subtaskNumber] = subtaskId.split('.');
    const parsedParentId = parseInt(parentTaskNumber, 10);
    const parsedSubtaskId = parseInt(subtaskNumber, 10);

    if (Number.isNaN(parsedParentId) || Number.isNaN(parsedSubtaskId)) {
        throw new DatabaseError(`Invalid subtask ID format: ${subtaskId}. Both parent and subtask IDs must be numeric.`);
    }

    return {
        parentTaskNumber: parsedParentId,
        subtaskNumber: parsedSubtaskId,
        originalId: subtaskId
    };
}

/**
 * Database-powered subtask removal function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} subtaskId - Subtask ID in format "parentId.subtaskId"
 * @param {boolean} convertToTask - Whether to convert subtask to standalone task
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Removal result
 */
async function removeSubtaskDb(
    userId,
    subtaskId,
    convertToTask = false,
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
            throw new DatabaseError('User ID is required for subtask removal');
        }

        // Parse subtask ID
        const parsedId = parseSubtaskId(subtaskId);
        const { parentTaskNumber, subtaskNumber, originalId } = parsedId;

        logFn.info(`Removing subtask ${originalId} (convertToTask: ${convertToTask})`);

        // Get parent task from database
        const parentTask = await db.tasks.getByNumber(userId, parentTaskNumber, projectId);
        if (!parentTask) {
            throw new DatabaseError(`Parent task #${parentTaskNumber} not found`);
        }

        // Get all subtasks for the parent task
        const subtasks = await db.subtasks.listByTask(userId, parentTask.id);
        const targetSubtask = subtasks.find(st => st.subtask_number === subtaskNumber);
        
        if (!targetSubtask) {
            throw new DatabaseError(`Subtask #${originalId} not found`);
        }

        logFn.info(`Found subtask #${originalId}: ${targetSubtask.title}`);

        let result = null;

        if (convertToTask) {
            // Case 1: Convert subtask to standalone task
            logFn.info(`Converting subtask #${originalId} to standalone task`);

            // Get next task number for new task
            const nextTaskNumber = await db.tasks.getNextNumber(userId, projectId);

            // Create new task from subtask data
            const taskData = {
                projectId,
                taskNumber: null, // Let database auto-assign
                title: targetSubtask.title,
                description: targetSubtask.description,
                priority: 'medium', // Default priority for converted subtasks
                status: targetSubtask.status,
                details: {
                    ...targetSubtask.details,
                    convertedFromSubtask: true,
                    originalSubtaskId: originalId,
                    originalParentTask: {
                        id: parentTaskNumber,
                        title: parentTask.title
                    }
                }
            };

            const newTask = await db.tasks.create(userId, taskData);

            // Log the conversion in history
            await db.history.log(userId, {
                taskId: parentTask.id,
                subtaskId: targetSubtask.id,
                action: 'converted_to_task',
                changeSummary: `Subtask #${originalId} converted to standalone task #${newTask.task_number}`,
                oldValue: {
                    subtaskId: originalId,
                    parentTaskId: parentTaskNumber,
                    title: targetSubtask.title
                },
                newValue: {
                    newTaskId: newTask.task_number,
                    newTaskUuid: newTask.id,
                    title: newTask.title
                }
            });

            // Also log creation of the new task
            await db.history.log(userId, {
                taskId: newTask.id,
                action: 'created',
                changeSummary: `Task #${newTask.task_number} created from subtask #${originalId}`,
                newValue: {
                    title: newTask.title,
                    status: newTask.status,
                    convertedFrom: originalId
                }
            });

            // Remove the original subtask
            await db.subtasks.delete(userId, targetSubtask.id);

            result = {
                id: newTask.task_number,
                uuid: newTask.id,
                title: newTask.title,
                description: newTask.description,
                status: newTask.status,
                priority: newTask.priority,
                details: newTask.details,
                created_at: newTask.created_at,
                updated_at: newTask.updated_at
            };

            logFn.info(`Successfully converted subtask #${originalId} to task #${newTask.task_number}`);

        } else {
            // Case 2: Simply delete the subtask
            logFn.info(`Deleting subtask #${originalId}`);

            // Log removal in history before deleting
            await db.history.log(userId, {
                taskId: parentTask.id,
                subtaskId: targetSubtask.id,
                action: 'deleted',
                changeSummary: `Subtask #${originalId} removed`,
                oldValue: {
                    subtaskId: originalId,
                    title: targetSubtask.title,
                    status: targetSubtask.status
                }
            });

            // Remove the subtask
            await db.subtasks.delete(userId, targetSubtask.id);

            logFn.info(`Successfully deleted subtask #${originalId}`);
        }

        return {
            success: true,
            action: convertToTask ? 'converted' : 'deleted',
            subtaskId: originalId,
            parentTaskId: parentTaskNumber,
            convertedTask: result,
            message: convertToTask 
                ? `Subtask ${originalId} successfully converted to task #${result.id}`
                : `Subtask ${originalId} successfully removed`
        };

    } catch (error) {
        logFn.error(`Error removing subtask: ${error.message}`);
        
        throw new DatabaseError(`Failed to remove subtask: ${error.message}`, error.code, {
            subtaskId,
            convertToTask,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for removing subtasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function removeSubtaskDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        convert,
        skipGenerate,
        projectRoot,
        tag
    } = args;

    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(`Removing subtask with args: ${JSON.stringify(args)}`);

        // Validate required parameters
        if (!id) {
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Subtask ID is required and must be in format "parentId.subtaskId"'
                }
            };
        }

        // Validate subtask ID format
        if (!id.includes('.')) {
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: `Invalid subtask ID format: ${id}. Expected format: "parentId.subtaskId"`
                }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        // Convert convertToTask to a boolean
        const convertToTask = convert === true;

        logWrapper.info(`Removing subtask ${id} (convertToTask: ${convertToTask}), ProjectRoot: ${projectRoot}`);

        // Call the database-powered remove function
        const result = await removeSubtaskDb(
            userId,
            id,
            convertToTask,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                tag
            }
        );

        logWrapper.info(result.message);

        if (convertToTask && result.convertedTask) {
            // Return info about the converted task
            return {
                success: true,
                data: {
                    message: result.message,
                    task: result.convertedTask,
                    action: 'converted'
                }
            };
        } else {
            // Return simple success message for deletion
            return {
                success: true,
                data: {
                    message: result.message,
                    action: 'deleted'
                }
            };
        }

    } catch (error) {
        logWrapper.error(`Error in removeSubtaskDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'REMOVE_SUBTASK_DB_ERROR',
                message: error.message || 'Unknown error removing subtask',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { removeSubtaskDb };