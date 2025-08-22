/**
 * next-task-db.js
 * Database-powered implementation for finding the next task to work on
 * 
 * This replaces the file-based next-task.js with database operations
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
 * Check if a task has all dependencies completed
 * @param {string} userId - User ID
 * @param {string} taskId - Task database ID (UUID)
 * @returns {Promise<boolean>} True if all dependencies are completed
 */
async function areTaskDependenciesCompleted(userId, taskId) {
    try {
        const dependencies = await db.dependencies.getByTask(userId, taskId);
        
        if (dependencies.length === 0) {
            return true; // No dependencies, task is ready
        }

        // Check if all dependency tasks are completed
        for (const dependency of dependencies) {
            const dependentTask = await db.tasks.getById(userId, dependency.depends_on_task_id);
            if (!dependentTask || dependentTask.status !== 'done') {
                return false; // At least one dependency is not completed
            }
        }

        return true;
    } catch (error) {
        console.warn(`Error checking dependencies for task ${taskId}: ${error.message}`);
        return true; // If we can't check dependencies, assume it's ready
    }
}

/**
 * Find the next available subtask within a task
 * @param {string} userId - User ID
 * @param {Object} task - Task object
 * @returns {Promise<Object|null>} Next subtask or null
 */
async function findNextSubtaskInTask(userId, task) {
    try {
        const subtasks = await db.subtasks.listByTask(userId, task.id);
        
        // Filter to only pending or in-progress subtasks
        const availableSubtasks = subtasks.filter(subtask => 
            subtask.status === 'pending' || subtask.status === 'in-progress'
        );

        if (availableSubtasks.length === 0) {
            return null;
        }

        // Return the first available subtask (could be enhanced with priority/dependency logic)
        const nextSubtask = availableSubtasks[0];
        
        return {
            id: `${task.task_number}.${nextSubtask.subtask_number}`,
            title: nextSubtask.title,
            description: nextSubtask.description,
            status: nextSubtask.status,
            details: nextSubtask.details || {},
            created_at: nextSubtask.created_at,
            updated_at: nextSubtask.updated_at,
            parentTask: {
                id: task.task_number,
                title: task.title,
                status: task.status
            }
        };
    } catch (error) {
        console.warn(`Error finding next subtask for task ${task.id}: ${error.message}`);
        return null;
    }
}

/**
 * Database-powered next task finding function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Next task result
 */
async function findNextTaskDb(
    userId,
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
            throw new DatabaseError('User ID is required for finding next task');
        }

        logFn.info('Finding next available task from database');

        // Get all tasks that are not completed or cancelled, ordered by creation date
        const availableTasks = await db.tasks.list(userId, {
            projectId,
            // Don't filter by status here - we'll check manually
        });

        // Filter out completed and cancelled tasks
        const eligibleTasks = availableTasks.filter(task => 
            task.status !== 'done' && task.status !== 'cancelled'
        );

        logFn.info(`Found ${eligibleTasks.length} eligible tasks to check`);

        // Check each task for readiness (dependencies and subtasks)
        for (const task of eligibleTasks) {
            // Check if task dependencies are satisfied
            const dependenciesCompleted = await areTaskDependenciesCompleted(userId, task.id);
            
            if (!dependenciesCompleted) {
                logFn.info(`Task #${task.task_number} has incomplete dependencies, skipping`);
                continue;
            }

            // If task has subtasks, check for next available subtask
            const subtasks = await db.subtasks.listByTask(userId, task.id);
            
            if (subtasks.length > 0) {
                // Task has subtasks - find the next available subtask
                const nextSubtask = await findNextSubtaskInTask(userId, task);
                
                if (nextSubtask) {
                    logFn.info(`Found next subtask: ${nextSubtask.id} - ${nextSubtask.title}`);
                    return {
                        nextTask: nextSubtask,
                        isSubtask: true,
                        taskType: 'subtask'
                    };
                }

                // No available subtasks, but check if task itself needs attention
                if (task.status === 'pending') {
                    logFn.info(`Task #${task.task_number} has no available subtasks but task itself is pending`);
                    return {
                        nextTask: {
                            id: task.task_number,
                            title: task.title,
                            description: task.description,
                            status: task.status,
                            priority: task.priority,
                            details: task.details || {},
                            created_at: task.created_at,
                            updated_at: task.updated_at,
                            subtaskCount: subtasks.length,
                            completedSubtasks: subtasks.filter(st => st.status === 'done').length
                        },
                        isSubtask: false,
                        taskType: 'task'
                    };
                }
            } else {
                // Task has no subtasks - check if task itself is available
                if (task.status === 'pending' || task.status === 'in-progress') {
                    logFn.info(`Found next task: #${task.task_number} - ${task.title}`);
                    return {
                        nextTask: {
                            id: task.task_number,
                            title: task.title,
                            description: task.description,
                            status: task.status,
                            priority: task.priority,
                            details: task.details || {},
                            created_at: task.created_at,
                            updated_at: task.updated_at
                        },
                        isSubtask: false,
                        taskType: 'task'
                    };
                }
            }
        }

        logFn.info('No eligible next task found. All tasks are either completed or have unsatisfied dependencies');
        
        return {
            nextTask: null,
            isSubtask: false,
            taskType: null,
            message: 'No eligible next task found. All tasks are either completed or have unsatisfied dependencies'
        };

    } catch (error) {
        logFn.error(`Error finding next task: ${error.message}`);
        
        throw new DatabaseError(`Failed to find next task: ${error.message}`, error.code, {
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for finding next task with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function nextTaskDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        reportPath,
        projectRoot,
        tag
    } = args;
    
    const { session } = context;
    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(`Finding next task from database, ProjectRoot: ${projectRoot}`);

        // Extract user ID from context
        const userId = getUserId(context);

        logWrapper.info(`Resolved user ID: ${userId}`);

        // Call the database-powered next task function
        const result = await findNextTaskDb(
            userId,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                projectRoot,
                session,
                tag
            }
        );

        if (!result.nextTask) {
            logWrapper.info('No eligible next task found');
            return {
                success: true,
                data: {
                    message: result.message || 'No eligible next task found',
                    nextTask: null
                }
            };
        }

        const isSubtask = result.isSubtask;
        const taskOrSubtask = isSubtask ? 'subtask' : 'task';

        const additionalAdvice = isSubtask
            ? 'Subtasks can be updated with timestamped details as you implement them. This is useful for tracking progress, marking milestones and insights (of successful or successive failures in attempting to implement the subtask). Research can be used when updating the subtask to collect up-to-date information, and can be helpful to solve a repeating problem the agent is unable to solve. It is a good idea to get-task the parent task to collect the overall context of the task, and to get-task the subtask to collect the specific details of the subtask.'
            : 'Tasks can be updated to reflect a change in the direction of the task, or to reformulate the task per your prompt. Research can be used when updating the task to collect up-to-date information. It is best to update subtasks as you work on them, and to update the task for more high-level changes that may affect pending subtasks or the general direction of the task.';

        logWrapper.info(`Successfully found next task ${result.nextTask.id}: ${result.nextTask.title}. Is subtask: ${isSubtask}`);

        return {
            success: true,
            data: {
                nextTask: result.nextTask,
                isSubtask,
                nextSteps: `When ready to work on the ${taskOrSubtask}, use set-status to set the status to "in-progress". ${additionalAdvice}`
            }
        };

    } catch (error) {
        logWrapper.error(`Error in nextTaskDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'NEXT_TASK_DB_ERROR',
                message: error.message || 'Unknown error finding next task',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { findNextTaskDb };