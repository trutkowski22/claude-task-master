/**
 * set-task-status-db.js
 * Database-powered implementation for setting task status
 * 
 * This replaces the file-based set-task-status.js with database operations
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
 * Validate task status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
function isValidStatus(status) {
    const validStatuses = ['pending', 'in-progress', 'done', 'review', 'deferred', 'cancelled'];
    return validStatuses.includes(status);
}

/**
 * Database-powered task status setting function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} taskIds - Comma-separated task IDs
 * @param {string} newStatus - New status to set
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Status update result
 */
async function setTaskStatusDb(
    userId,
    taskIds,
    newStatus,
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
            throw new DatabaseError('User ID is required for task status update');
        }

        // Validate status
        if (!isValidStatus(newStatus)) {
            throw new DatabaseError(`Invalid status: ${newStatus}. Valid statuses are: pending, in-progress, done, review, deferred, cancelled`);
        }

        // Split task IDs if comma-separated
        const taskIdArray = taskIds.split(',').map((taskId) => taskId.trim());

        logFn.info(`Setting status "${newStatus}" for ${taskIdArray.length} task(s): ${taskIdArray.join(', ')}`);

        const updatedTasks = [];
        const failedUpdates = [];

        // Process each task ID
        for (const taskId of taskIdArray) {
            try {
                const parsedId = parseTaskId(taskId);
                
                if (parsedId.isSubtask) {
                    // Handle subtask status update
                    const task = await db.tasks.getByNumber(userId, parsedId.taskNumber, projectId);
                    if (!task) {
                        failedUpdates.push({
                            id: taskId,
                            reason: `Parent task #${parsedId.taskNumber} not found`
                        });
                        continue;
                    }

                    const subtasks = await db.subtasks.listByTask(userId, task.id);
                    const targetSubtask = subtasks.find(st => st.subtask_number === parsedId.subtaskNumber);
                    
                    if (!targetSubtask) {
                        failedUpdates.push({
                            id: taskId,
                            reason: `Subtask #${parsedId.originalId} not found`
                        });
                        continue;
                    }

                    const oldStatus = targetSubtask.status;

                    // Update subtask status
                    const updatedSubtask = await db.subtasks.update(userId, targetSubtask.id, {
                        status: newStatus
                    });

                    // Log status change in history
                    await db.history.log(userId, {
                        taskId: task.id,
                        subtaskId: targetSubtask.id,
                        action: 'status_changed',
                        changeSummary: `Subtask #${parsedId.originalId} status changed from "${oldStatus}" to "${newStatus}"`,
                        oldValue: { status: oldStatus },
                        newValue: { status: newStatus }
                    });

                    updatedTasks.push({
                        id: parsedId.originalId,
                        type: 'subtask',
                        title: targetSubtask.title,
                        oldStatus,
                        newStatus,
                        parentTaskId: parsedId.taskNumber
                    });

                    logFn.info(`Successfully updated subtask #${parsedId.originalId} status from "${oldStatus}" to "${newStatus}"`);

                } else {
                    // Handle main task status update
                    const task = await db.tasks.getByNumber(userId, parsedId.taskNumber, projectId);
                    if (!task) {
                        failedUpdates.push({
                            id: taskId,
                            reason: `Task #${parsedId.taskNumber} not found`
                        });
                        continue;
                    }

                    const oldStatus = task.status;

                    // Update task status
                    const updatedTask = await db.tasks.updateStatus(userId, task.id, newStatus);

                    // Log status change in history
                    await db.history.log(userId, {
                        taskId: task.id,
                        action: 'status_changed',
                        changeSummary: `Task #${parsedId.taskNumber} status changed from "${oldStatus}" to "${newStatus}"`,
                        oldValue: { status: oldStatus },
                        newValue: { status: newStatus }
                    });

                    updatedTasks.push({
                        id: parsedId.originalId,
                        type: 'task',
                        title: task.title,
                        oldStatus,
                        newStatus
                    });

                    logFn.info(`Successfully updated task #${parsedId.taskNumber} status from "${oldStatus}" to "${newStatus}"`);
                }

            } catch (error) {
                logFn.warn(`Failed to update status for ${taskId}: ${error.message}`);
                failedUpdates.push({
                    id: taskId,
                    reason: error.message
                });
            }
        }

        const successMessage = `Successfully updated status for ${updatedTasks.length} of ${taskIdArray.length} requested items`;
        logFn.info(successMessage);

        return {
            success: true,
            totalRequested: taskIdArray.length,
            successfulUpdates: updatedTasks.length,
            failedUpdates: failedUpdates.length,
            updatedTasks,
            failedUpdates,
            newStatus,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error setting task status: ${error.message}`);
        
        throw new DatabaseError(`Failed to set task status: ${error.message}`, error.code, {
            taskIds,
            newStatus,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Get next available task using database operations
 * This is a simplified version for status update integration
 */
async function getNextTaskDb(userId, projectId = null, logFn) {
    try {
        // Get all pending tasks ordered by creation date
        const pendingTasks = await db.tasks.list(userId, {
            projectId,
            status: 'pending'
        });

        if (pendingTasks.length === 0) {
            return null;
        }

        // Return the first pending task (could be enhanced with dependency checking)
        const nextTask = pendingTasks[0];
        return {
            id: nextTask.task_number,
            title: nextTask.title,
            description: nextTask.description,
            priority: nextTask.priority
        };
    } catch (error) {
        logFn.warn(`Failed to get next task: ${error.message}`);
        return null;
    }
}

/**
 * Direct function wrapper for setting task status with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function setTaskStatusDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        status,
        complexityReportPath,
        projectRoot,
        tag
    } = args;
    
    const { session } = context;
    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(`Setting task status with args: ${JSON.stringify(args)}`);

        // Validate required parameters
        if (!id) {
            const errorMessage = 'No task ID specified. Please provide a task ID to update.';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'MISSING_TASK_ID', message: errorMessage }
            };
        }

        if (!status) {
            const errorMessage = 'No status specified. Please provide a new status value.';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'MISSING_STATUS', message: errorMessage }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        logWrapper.info(`Setting task ${id} status to "${status}"`);

        // Call the database-powered status update function
        const result = await setTaskStatusDb(
            userId,
            id,
            status,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                session,
                tag
            }
        );

        logWrapper.info(`Successfully set task ${id} status to ${status}`);

        // Prepare the response data
        const responseData = {
            message: `Successfully updated task ${id} status to "${status}"`,
            taskId: id,
            status: status,
            totalUpdated: result.successfulUpdates,
            updatedTasks: result.updatedTasks
        };

        // If the task was completed, attempt to fetch the next task
        if (status === 'done' && result.successfulUpdates > 0) {
            try {
                logWrapper.info(`Attempting to fetch next task for completed task ${id}`);
                const nextTask = await getNextTaskDb(userId, null, logWrapper);
                
                if (nextTask) {
                    logWrapper.info(`Successfully retrieved next task: ${nextTask.id}`);
                    responseData.nextTask = nextTask;
                    responseData.nextSteps = `Next task to work on: #${nextTask.id} - ${nextTask.title}`;
                } else {
                    logWrapper.info('No next task available');
                    responseData.nextSteps = 'No more pending tasks available';
                }
            } catch (nextErr) {
                logWrapper.error(`Error retrieving next task: ${nextErr.message}`);
            }
        }

        return {
            success: true,
            data: responseData
        };

    } catch (error) {
        logWrapper.error(`Error in setTaskStatusDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'SET_STATUS_DB_ERROR',
                message: error.message || 'Unknown error setting task status',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { setTaskStatusDb };