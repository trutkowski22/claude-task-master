/**
 * clear-subtasks-db.js
 * Database-powered implementation for clearing subtasks from specified tasks
 * 
 * This replaces the file-based clear-subtasks.js with database operations
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
 * Database-powered subtasks clearing function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} taskIds - Comma-separated task IDs (optional)
 * @param {boolean} clearAll - Clear subtasks from all tasks
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Clear result
 */
async function clearSubtasksDb(
    userId,
    taskIds = null,
    clearAll = false,
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
            throw new DatabaseError('User ID is required for subtasks clearing');
        }

        let targetTasks = [];

        if (clearAll) {
            // Get all tasks for the user
            logFn.info('Clearing subtasks from all tasks');
            targetTasks = await db.tasks.list(userId, { projectId });
            
            if (targetTasks.length === 0) {
                logFn.info('No tasks found to clear subtasks from');
                return {
                    success: true,
                    clearedTasksCount: 0,
                    totalSubtasksCleared: 0,
                    tasksCleared: [],
                    message: 'No tasks found to clear subtasks from'
                };
            }
        } else if (taskIds) {
            // Parse specific task IDs
            const taskIdArray = taskIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
            
            if (taskIdArray.length === 0) {
                throw new DatabaseError('No valid task IDs provided');
            }

            logFn.info(`Clearing subtasks from specific tasks: ${taskIdArray.join(', ')}`);
            
            // Get each specified task
            for (const taskNumber of taskIdArray) {
                try {
                    const task = await db.tasks.getByNumber(userId, taskNumber, projectId);
                    if (task) {
                        targetTasks.push(task);
                    } else {
                        logFn.warn(`Task #${taskNumber} not found, skipping`);
                    }
                } catch (error) {
                    logFn.warn(`Error fetching task #${taskNumber}: ${error.message}`);
                }
            }

            if (targetTasks.length === 0) {
                throw new DatabaseError('No valid tasks found for the specified IDs');
            }
        } else {
            throw new DatabaseError('Either task IDs or clearAll parameter must be provided');
        }

        const clearedTasks = [];
        let totalSubtasksCleared = 0;

        // Process each target task
        for (const task of targetTasks) {
            try {
                // Get all subtasks for this task
                const subtasks = await db.subtasks.listByTask(userId, task.id);
                
                if (subtasks.length === 0) {
                    logFn.info(`Task #${task.task_number} has no subtasks to clear`);
                    clearedTasks.push({
                        id: task.task_number,
                        title: task.title,
                        subtasksCleared: 0
                    });
                    continue;
                }

                logFn.info(`Clearing ${subtasks.length} subtasks from task #${task.task_number}: ${task.title}`);

                // Log the clearing operation in history before deletion
                await db.history.log(userId, {
                    taskId: task.id,
                    action: 'subtasks_cleared',
                    changeSummary: `All ${subtasks.length} subtasks cleared from task #${task.task_number}`,
                    oldValue: {
                        subtaskCount: subtasks.length,
                        subtasks: subtasks.map(st => ({
                            id: `${task.task_number}.${st.subtask_number}`,
                            title: st.title,
                            status: st.status
                        }))
                    }
                });

                // Clear all subtasks for this task
                const clearedCount = await db.subtasks.clearByTask(userId, task.id);
                
                totalSubtasksCleared += clearedCount;
                clearedTasks.push({
                    id: task.task_number,
                    title: task.title,
                    subtasksCleared: clearedCount
                });

                logFn.info(`Successfully cleared ${clearedCount} subtasks from task #${task.task_number}`);

            } catch (error) {
                logFn.error(`Error clearing subtasks from task #${task.task_number}: ${error.message}`);
                clearedTasks.push({
                    id: task.task_number,
                    title: task.title,
                    subtasksCleared: 0,
                    error: error.message
                });
            }
        }

        const successMessage = `Successfully cleared subtasks from ${clearedTasks.length} task(s). Total subtasks cleared: ${totalSubtasksCleared}`;
        logFn.info(successMessage);

        return {
            success: true,
            clearedTasksCount: clearedTasks.length,
            totalSubtasksCleared,
            tasksCleared: clearedTasks,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error clearing subtasks: ${error.message}`);
        
        throw new DatabaseError(`Failed to clear subtasks: ${error.message}`, error.code, {
            taskIds,
            clearAll,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for clearing subtasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function clearSubtasksDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        all,
        tag,
        projectRoot
    } = args;

    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(`Clearing subtasks with args: ${JSON.stringify(args)}`);

        // Either id or all must be provided
        if (!id && !all) {
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Either task IDs with id parameter or all parameter must be provided'
                }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        logWrapper.info(`Clearing subtasks, ProjectRoot: ${projectRoot}, Tag: ${tag}`);

        // Call the database-powered clear function
        const result = await clearSubtasksDb(
            userId,
            id,
            all === true,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                tag
            }
        );

        logWrapper.info(result.message);

        // Build a summary in the expected format
        return {
            success: true,
            data: {
                message: result.message,
                tasksCleared: result.tasksCleared,
                clearedTasksCount: result.clearedTasksCount,
                totalSubtasksCleared: result.totalSubtasksCleared,
                tag: tag || 'default'
            }
        };

    } catch (error) {
        logWrapper.error(`Error in clearSubtasksDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'CLEAR_SUBTASKS_DB_ERROR',
                message: error.message || 'Unknown error clearing subtasks',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { clearSubtasksDb };