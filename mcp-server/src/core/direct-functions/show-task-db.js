/**
 * show-task-db.js
 * Database-powered implementation for showing task details
 * 
 * This replaces the file-based show-task.js with database operations
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
 * Fetch task with subtasks from database
 * @param {string} userId - User ID
 * @param {number} taskNumber - Task number
 * @param {string} projectId - Project ID (optional)
 * @param {string} statusFilter - Status filter for subtasks (optional)
 * @returns {Promise<Object>} Task with subtasks
 */
async function fetchTaskWithSubtasks(userId, taskNumber, projectId = null, statusFilter = null) {
    // Get the main task
    const task = await db.tasks.getByNumber(userId, taskNumber, projectId);
    if (!task) {
        return null;
    }

    // Get all subtasks for this task
    const allSubtasks = await db.subtasks.listByTask(userId, task.id);
    
    // Filter subtasks by status if specified
    let filteredSubtasks = allSubtasks;
    if (statusFilter) {
        filteredSubtasks = allSubtasks.filter(subtask => subtask.status === statusFilter);
    }

    // Transform database format to match expected API format
    const formattedTask = {
        id: task.task_number,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        details: task.details || {},
        created_at: task.created_at,
        updated_at: task.updated_at,
        subtasks: filteredSubtasks.map(subtask => ({
            id: `${task.task_number}.${subtask.subtask_number}`,
            title: subtask.title,
            description: subtask.description,
            status: subtask.status,
            details: subtask.details || {},
            created_at: subtask.created_at,
            updated_at: subtask.updated_at
        }))
    };

    return {
        task: formattedTask,
        originalSubtaskCount: allSubtasks.length
    };
}

/**
 * Fetch specific subtask from database
 * @param {string} userId - User ID
 * @param {number} taskNumber - Task number
 * @param {number} subtaskNumber - Subtask number
 * @param {string} projectId - Project ID (optional)
 * @returns {Promise<Object>} Subtask details
 */
async function fetchSubtask(userId, taskNumber, subtaskNumber, projectId = null) {
    // Get the main task first
    const task = await db.tasks.getByNumber(userId, taskNumber, projectId);
    if (!task) {
        return null;
    }

    // Get all subtasks and find the specific one
    const subtasks = await db.subtasks.listByTask(userId, task.id);
    const targetSubtask = subtasks.find(st => st.subtask_number === subtaskNumber);
    
    if (!targetSubtask) {
        return null;
    }

    // Return subtask in expected format
    return {
        task: {
            id: `${taskNumber}.${subtaskNumber}`,
            title: targetSubtask.title,
            description: targetSubtask.description,
            status: targetSubtask.status,
            details: targetSubtask.details || {},
            created_at: targetSubtask.created_at,
            updated_at: targetSubtask.updated_at,
            parentTask: {
                id: task.task_number,
                title: task.title,
                status: task.status
            }
        },
        originalSubtaskCount: null
    };
}

/**
 * Database-powered task retrieval function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} taskIds - Comma-separated task IDs or single task ID
 * @param {string} statusFilter - Status filter for subtasks (optional)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Task details result
 */
async function showTaskDb(
    userId,
    taskIds,
    statusFilter = null,
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
            throw new DatabaseError('User ID is required for task retrieval');
        }

        // Parse comma-separated IDs
        const taskIdArray = taskIds
            .split(',')
            .map((taskId) => taskId.trim())
            .filter((taskId) => taskId.length > 0);

        if (taskIdArray.length === 0) {
            throw new DatabaseError('No valid task IDs provided');
        }

        logFn.info(`Retrieving ${taskIdArray.length} task(s): ${taskIdArray.join(', ')}`);

        // Handle single task ID (existing behavior)
        if (taskIdArray.length === 1) {
            const parsedId = parseTaskId(taskIdArray[0]);
            
            let result;
            if (parsedId.isSubtask) {
                result = await fetchSubtask(userId, parsedId.taskNumber, parsedId.subtaskNumber, projectId);
            } else {
                result = await fetchTaskWithSubtasks(userId, parsedId.taskNumber, projectId, statusFilter);
            }

            if (!result) {
                throw new DatabaseError(`Task or subtask with ID ${taskIdArray[0]} not found`);
            }

            logFn.info(`Successfully retrieved task ${taskIdArray[0]}`);

            const returnData = { ...result.task };
            if (result.originalSubtaskCount !== null) {
                returnData._originalSubtaskCount = result.originalSubtaskCount;
                returnData._subtaskFilter = statusFilter;
            }

            return returnData;
        }

        // Handle multiple task IDs
        const foundTasks = [];
        const notFoundIds = [];

        for (const taskId of taskIdArray) {
            try {
                const parsedId = parseTaskId(taskId);
                
                let result;
                if (parsedId.isSubtask) {
                    result = await fetchSubtask(userId, parsedId.taskNumber, parsedId.subtaskNumber, projectId);
                } else {
                    result = await fetchTaskWithSubtasks(userId, parsedId.taskNumber, projectId, statusFilter);
                }

                if (result) {
                    const taskData = { ...result.task };
                    if (result.originalSubtaskCount !== null) {
                        taskData._originalSubtaskCount = result.originalSubtaskCount;
                        taskData._subtaskFilter = statusFilter;
                    }
                    foundTasks.push(taskData);
                } else {
                    notFoundIds.push(taskId);
                }
            } catch (error) {
                logFn.warn(`Error retrieving task ${taskId}: ${error.message}`);
                notFoundIds.push(taskId);
            }
        }

        logFn.info(`Successfully retrieved ${foundTasks.length} of ${taskIdArray.length} requested tasks`);

        // Return multiple tasks with metadata
        return {
            tasks: foundTasks,
            requestedIds: taskIdArray,
            foundCount: foundTasks.length,
            notFoundIds: notFoundIds,
            isMultiple: true
        };

    } catch (error) {
        logFn.error(`Error showing task(s): ${error.message}`);
        
        throw new DatabaseError(`Failed to retrieve task(s): ${error.message}`, error.code, {
            taskIds,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for showing task details with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function showTaskDirect(args, log, context = {}) {
    const { 
        id, 
        file, 
        reportPath, 
        status, 
        projectRoot, 
        tag 
    } = args;

    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(
            `Showing task direct function. ID: ${id}, File: ${file}, Status Filter: ${status}, ProjectRoot: ${projectRoot}`
        );

        // Validate required parameters
        if (!id) {
            const errorMessage = 'No task ID specified. Please provide a task ID to show.';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'MISSING_TASK_ID', message: errorMessage }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        logWrapper.info(`Resolved user ID: ${userId}`);

        // Call the database-powered show function
        const result = await showTaskDb(
            userId,
            id,
            status,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                tag
            }
        );

        logWrapper.info(`Successfully retrieved task(s) ${id}`);

        return {
            success: true,
            data: result
        };

    } catch (error) {
        logWrapper.error(`Error showing task ${id}: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'SHOW_TASK_DB_ERROR',
                message: error.message || 'Unknown error showing task',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { showTaskDb };