/**
 * list-tasks-db.js
 * Database-powered implementation for listing tasks
 * 
 * This replaces the file-based list-tasks.js with database operations
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
 * Format task data to match expected API format
 * @param {Object} task - Database task object
 * @param {Array} subtasks - Array of subtasks (optional)
 * @returns {Object} Formatted task
 */
function formatTask(task, subtasks = []) {
    return {
        id: task.task_number,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        details: task.details || {},
        created_at: task.created_at,
        updated_at: task.updated_at,
        subtasks: subtasks.map(subtask => ({
            id: `${task.task_number}.${subtask.subtask_number}`,
            title: subtask.title,
            description: subtask.description,
            status: subtask.status,
            details: subtask.details || {},
            created_at: subtask.created_at,
            updated_at: subtask.updated_at
        }))
    };
}

/**
 * Database-powered task listing function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} statusFilter - Status filter ('all', 'pending', 'done', etc.)
 * @param {boolean} withSubtasks - Whether to include subtasks
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Task list result
 */
async function listTasksDb(
    userId,
    statusFilter = 'all',
    withSubtasks = false,
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
            throw new DatabaseError('User ID is required for task listing');
        }

        logFn.info(`Listing tasks with filter: ${statusFilter}, subtasks: ${withSubtasks}`);

        // Prepare options for task listing
        const options = {
            projectId
        };

        // Add status filter if not 'all'
        if (statusFilter && statusFilter !== 'all') {
            options.status = statusFilter;
        }

        // Get all tasks from database
        const tasks = await db.tasks.list(userId, options);

        logFn.info(`Retrieved ${tasks.length} tasks from database`);

        // Format tasks for response
        const formattedTasks = [];
        
        for (const task of tasks) {
            if (withSubtasks) {
                // Get subtasks for this task
                const subtasks = await db.subtasks.listByTask(userId, task.id);
                
                // Filter subtasks by status if specified and not 'all'
                let filteredSubtasks = subtasks;
                if (statusFilter && statusFilter !== 'all') {
                    filteredSubtasks = subtasks.filter(subtask => subtask.status === statusFilter);
                }
                
                formattedTasks.push(formatTask(task, filteredSubtasks));
            } else {
                formattedTasks.push(formatTask(task));
            }
        }

        // Calculate statistics
        const stats = {
            total: formattedTasks.length,
            pending: formattedTasks.filter(t => t.status === 'pending').length,
            'in-progress': formattedTasks.filter(t => t.status === 'in-progress').length,
            done: formattedTasks.filter(t => t.status === 'done').length,
            review: formattedTasks.filter(t => t.status === 'review').length,
            deferred: formattedTasks.filter(t => t.status === 'deferred').length,
            cancelled: formattedTasks.filter(t => t.status === 'cancelled').length
        };

        // Calculate subtask statistics if included
        let subtaskStats = null;
        if (withSubtasks) {
            const allSubtasks = formattedTasks.flatMap(task => task.subtasks);
            subtaskStats = {
                total: allSubtasks.length,
                pending: allSubtasks.filter(st => st.status === 'pending').length,
                'in-progress': allSubtasks.filter(st => st.status === 'in-progress').length,
                done: allSubtasks.filter(st => st.status === 'done').length,
                review: allSubtasks.filter(st => st.status === 'review').length,
                deferred: allSubtasks.filter(st => st.status === 'deferred').length,
                cancelled: allSubtasks.filter(st => st.status === 'cancelled').length
            };
        }

        logFn.info(`Formatted ${formattedTasks.length} tasks for response`);

        return {
            tasks: formattedTasks,
            stats,
            subtaskStats,
            filter: statusFilter,
            withSubtasks,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        logFn.error(`Error listing tasks: ${error.message}`);
        
        throw new DatabaseError(`Failed to list tasks: ${error.message}`, error.code, {
            statusFilter,
            withSubtasks,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for listing tasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function listTasksDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        reportPath,
        status,
        withSubtasks,
        projectRoot,
        tag
    } = args;
    
    const { session } = context;
    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(
            `Listing tasks direct function. Status: ${status}, Subtasks: ${withSubtasks}, ProjectRoot: ${projectRoot}`
        );

        // Extract user ID from context
        const userId = getUserId(context);

        const statusFilter = status || 'all';
        const withSubtasksFilter = withSubtasks || false;

        logWrapper.info(`Resolved user ID: ${userId}`);

        // Call the database-powered list function
        const result = await listTasksDb(
            userId,
            statusFilter,
            withSubtasksFilter,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                session,
                tag
            }
        );

        logWrapper.info(`Successfully listed ${result.tasks.length} tasks`);

        return {
            success: true,
            data: result
        };

    } catch (error) {
        logWrapper.error(`Error in listTasksDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'LIST_TASKS_DB_ERROR',
                message: error.message || 'Unknown error listing tasks',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { listTasksDb };