/**
 * remove-task-db.js
 * Database-powered implementation for removing tasks
 * 
 * This replaces the file-based remove-task.js with database operations
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
 * Parse task ID to handle both string and numeric IDs, including subtask IDs
 * @param {string|number} id - Task ID (can be "5.2" for subtasks or "5" for main tasks)
 * @returns {Object} Parsed ID information
 */
function parseTaskId(id) {
    if (typeof id === 'string') {
        // Handle subtask IDs (e.g., "5.2")
        if (id.includes('.')) {
            const [taskNumber, subtaskNumber] = id.split('.');
            return {
                isSubtask: true,
                taskNumber: parseInt(taskNumber, 10),
                subtaskNumber: parseInt(subtaskNumber, 10),
                originalId: id
            };
        } else {
            // Parse as integer for main task IDs
            const taskNumber = parseInt(id, 10);
            if (Number.isNaN(taskNumber)) {
                throw new DatabaseError(`Invalid task ID: ${id}. Task ID must be a positive integer or subtask ID (e.g., "5.2").`);
            }
            return {
                isSubtask: false,
                taskNumber,
                originalId: id
            };
        }
    } else {
        return {
            isSubtask: false,
            taskNumber: id,
            originalId: id
        };
    }
}

/**
 * Database-powered task removal function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} taskIds - Comma-separated task IDs
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Removal result
 */
async function removeTaskDb(
    userId,
    taskIds,
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
            throw new DatabaseError('User ID is required for task removal');
        }

        // Split task IDs if comma-separated
        const taskIdArray = taskIds.split(',').map((taskId) => taskId.trim());

        logFn.info(`Removing ${taskIdArray.length} task(s) with ID(s): ${taskIdArray.join(', ')}`);

        const removedTasks = [];
        const failedRemovals = [];

        // Process each task ID
        for (const taskId of taskIdArray) {
            try {
                const parsedId = parseTaskId(taskId);
                
                if (parsedId.isSubtask) {
                    // Handle subtask removal
                    const task = await db.tasks.getByNumber(userId, parsedId.taskNumber, projectId);
                    if (!task) {
                        failedRemovals.push({
                            id: taskId,
                            reason: `Parent task #${parsedId.taskNumber} not found`
                        });
                        continue;
                    }

                    const subtasks = await db.subtasks.listByTask(userId, task.id);
                    const targetSubtask = subtasks.find(st => st.subtask_number === parsedId.subtaskNumber);
                    
                    if (!targetSubtask) {
                        failedRemovals.push({
                            id: taskId,
                            reason: `Subtask #${parsedId.originalId} not found`
                        });
                        continue;
                    }

                    // Log removal in history before deleting
                    await db.history.log(userId, {
                        taskId: task.id,
                        subtaskId: targetSubtask.id,
                        action: 'deleted',
                        changeSummary: `Subtask #${parsedId.originalId} removed`,
                        oldValue: {
                            title: targetSubtask.title,
                            status: targetSubtask.status
                        }
                    });

                    // Remove the subtask
                    await db.subtasks.delete(userId, targetSubtask.id);
                    
                    removedTasks.push({
                        id: parsedId.originalId,
                        type: 'subtask',
                        title: targetSubtask.title,
                        parentTaskId: parsedId.taskNumber
                    });

                    logFn.info(`Successfully removed subtask #${parsedId.originalId}`);

                } else {
                    // Handle main task removal
                    const task = await db.tasks.getByNumber(userId, parsedId.taskNumber, projectId);
                    if (!task) {
                        failedRemovals.push({
                            id: taskId,
                            reason: `Task #${parsedId.taskNumber} not found`
                        });
                        continue;
                    }

                    // Get all subtasks for cascading deletion
                    const subtasks = await db.subtasks.listByTask(userId, task.id);

                    // Log removal in history before deleting
                    await db.history.log(userId, {
                        taskId: task.id,
                        action: 'deleted',
                        changeSummary: `Task #${parsedId.taskNumber} removed with ${subtasks.length} subtasks`,
                        oldValue: {
                            title: task.title,
                            status: task.status,
                            subtaskCount: subtasks.length
                        }
                    });

                    // Remove all subtasks first (cascading delete)
                    if (subtasks.length > 0) {
                        await db.subtasks.clearByTask(userId, task.id);
                        logFn.info(`Removed ${subtasks.length} subtasks for task #${parsedId.taskNumber}`);
                    }

                    // Remove the main task
                    await db.tasks.delete(userId, task.id);
                    
                    removedTasks.push({
                        id: parsedId.originalId,
                        type: 'task',
                        title: task.title,
                        subtasksRemoved: subtasks.length
                    });

                    logFn.info(`Successfully removed task #${parsedId.taskNumber} with ${subtasks.length} subtasks`);
                }

            } catch (error) {
                logFn.warn(`Failed to remove ${taskId}: ${error.message}`);
                failedRemovals.push({
                    id: taskId,
                    reason: error.message
                });
            }
        }

        const successMessage = `Successfully removed ${removedTasks.length} of ${taskIdArray.length} requested items`;
        logFn.info(successMessage);

        return {
            success: true,
            totalRequested: taskIdArray.length,
            successfulRemovals: removedTasks.length,
            failedRemovals: failedRemovals.length,
            removedTasks,
            failedRemovals,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error removing tasks: ${error.message}`);
        
        throw new DatabaseError(`Failed to remove tasks: ${error.message}`, error.code, {
            taskIds,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for removing tasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function removeTaskDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        projectRoot,
        tag
    } = args;
    
    const { session } = context;
    const logWrapper = createLogWrapper(log);

    try {
        // Validate required parameters
        if (!id) {
            logWrapper.error('Task ID is required');
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Task ID is required'
                }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        logWrapper.info(`Removing task(s) with ID(s): ${id}, ProjectRoot: ${projectRoot}`);

        // Call the database-powered remove function
        const result = await removeTaskDb(
            userId,
            id,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                session,
                tag
            }
        );

        logWrapper.info(`Successfully processed removal request for ${result.totalRequested} item(s)`);

        return {
            success: true,
            data: {
                totalTasks: result.totalRequested,
                successful: result.successfulRemovals,
                failed: result.failedRemovals,
                removedTasks: result.removedTasks,
                failedRemovals: result.failedRemovals,
                message: result.message,
                tag
            }
        };

    } catch (error) {
        logWrapper.error(`Error in removeTaskDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'REMOVE_TASK_DB_ERROR',
                message: error.message || 'Unknown error removing task',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { removeTaskDb };