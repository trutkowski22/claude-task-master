/**
 * add-dependency-db.js
 * Database-powered implementation for adding a dependency to a task
 * 
 * This replaces the file-based add-dependency.js with database operations
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
 * Parse task ID to determine if it's a subtask
 * @param {string|number} taskId - Task ID (e.g., "5" or "5.2")
 * @returns {Object} - { isSubtask: boolean, parentId: number|null, subtaskId: number|null, taskNumber: number }
 */
function parseTaskId(taskId) {
    const taskIdStr = String(taskId);
    
    if (taskIdStr.includes('.')) {
        // This is a subtask
        const parts = taskIdStr.split('.');
        const parentId = parseInt(parts[0], 10);
        const subtaskId = parseInt(parts[1], 10);
        
        return {
            isSubtask: true,
            parentId,
            subtaskId,
            taskNumber: parentId
        };
    } else {
        // This is a main task
        const taskNumber = parseInt(taskIdStr, 10);
        return {
            isSubtask: false,
            parentId: null,
            subtaskId: null,
            taskNumber
        };
    }
}

/**
 * Database-powered dependency addition function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string|number} taskId - Task ID to add dependency to
 * @param {string|number} dependsOnId - Task ID that will become a dependency
 * @param {Object} options - Dependency addition options
 * @param {string} options.tag - Tag context (optional)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Dependency addition result
 */
async function addDependencyDb(
    userId,
    taskId,
    dependsOnId,
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
            throw new DatabaseError('User ID is required for dependency management');
        }

        // Validate task IDs
        if (!taskId) {
            throw new DatabaseError('Task ID is required');
        }

        if (!dependsOnId) {
            throw new DatabaseError('Dependency task ID (dependsOn) is required');
        }

        const { tag } = options;

        // Parse task IDs
        const targetTask = parseTaskId(taskId);
        const dependencyTask = parseTaskId(dependsOnId);

        logFn.info(`Adding dependency: task ${taskId} will depend on ${dependsOnId}`);

        // Validate that both tasks exist in the database
        let targetTaskRecord, dependencyTaskRecord;

        // Get target task
        try {
            targetTaskRecord = await db.tasks.getByTaskNumber(userId, targetTask.taskNumber);
            if (!targetTaskRecord) {
                throw new DatabaseError(`Target task #${targetTask.taskNumber} not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Target task #${targetTask.taskNumber} not found: ${error.message}`);
        }

        // Get dependency task
        try {
            dependencyTaskRecord = await db.tasks.getByTaskNumber(userId, dependencyTask.taskNumber);
            if (!dependencyTaskRecord) {
                throw new DatabaseError(`Dependency task #${dependencyTask.taskNumber} not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Dependency task #${dependencyTask.taskNumber} not found: ${error.message}`);
        }

        // Check for self-dependency
        if (targetTask.taskNumber === dependencyTask.taskNumber) {
            throw new DatabaseError('A task cannot depend on itself');
        }

        // For subtasks, we'll store dependencies on the parent task level
        // This maintains compatibility with the existing system
        const actualTargetTaskId = targetTaskRecord.id;
        const actualDependencyTaskId = dependencyTaskRecord.id;

        // Check if dependency already exists
        const existingDependencies = targetTaskRecord.dependencies || [];
        if (existingDependencies.includes(actualDependencyTaskId)) {
            throw new DatabaseError(`Task #${targetTask.taskNumber} already depends on task #${dependencyTask.taskNumber}`);
        }

        // Add the dependency
        const updatedDependencies = [...existingDependencies, actualDependencyTaskId];
        
        // Update the task with new dependency
        await db.tasks.update(userId, actualTargetTaskId, {
            dependencies: updatedDependencies
        });

        logFn.info(`Successfully added dependency: Task #${targetTask.taskNumber} now depends on #${dependencyTask.taskNumber}`);

        // Validate that adding this dependency doesn't create circular references
        // This is a simplified check - a full implementation would do a graph traversal
        const targetDependsOnItself = await checkCircularDependency(userId, actualTargetTaskId, actualDependencyTaskId);
        if (targetDependsOnItself) {
            // Rollback the dependency addition
            await db.tasks.update(userId, actualTargetTaskId, {
                dependencies: existingDependencies
            });
            
            throw new DatabaseError('Adding this dependency would create a circular reference');
        }

        // Log dependency addition in history
        await db.history.log(userId, {
            action: 'dependency_added',
            changeSummary: `Added dependency: Task #${targetTask.taskNumber} depends on #${dependencyTask.taskNumber}`,
            taskId: actualTargetTaskId,
            newValue: {
                taskId: targetTask.taskNumber,
                dependsOn: dependencyTask.taskNumber,
                dependencies: updatedDependencies
            }
        });

        const successMessage = `Successfully added dependency: Task #${targetTask.taskNumber} now depends on #${dependencyTask.taskNumber}`;

        logFn.info(successMessage);

        return {
            success: true,
            taskId: taskId,
            dependencyId: dependsOnId,
            targetTaskNumber: targetTask.taskNumber,
            dependencyTaskNumber: dependencyTask.taskNumber,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error adding dependency: ${error.message}`);
        
        throw new DatabaseError(`Failed to add dependency: ${error.message}`, error.code, {
            taskId,
            dependsOnId,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Simple circular dependency check
 * This is a basic implementation - a full version would do comprehensive graph traversal
 */
async function checkCircularDependency(userId, taskId, potentialDependencyId, visited = new Set()) {
    // Prevent infinite recursion
    if (visited.has(taskId)) {
        return false;
    }
    
    visited.add(taskId);
    
    try {
        const task = await db.tasks.getById(userId, potentialDependencyId);
        if (!task || !task.dependencies) {
            return false;
        }
        
        // Check if any of the dependency's dependencies point back to our original task
        for (const depId of task.dependencies) {
            if (depId === taskId) {
                return true;
            }
            
            // Recursively check dependencies
            if (await checkCircularDependency(userId, taskId, depId, visited)) {
                return true;
            }
        }
        
        return false;
    } catch (error) {
        // If we can't check, assume no circular dependency
        return false;
    }
}

/**
 * Direct function wrapper for adding dependencies with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function addDependencyDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        dependsOn,
        tag,
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Validate required parameters
        if (!id) {
            mcpLog.error('Missing required parameter: id');
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Task ID (id) is required'
                }
            };
        }

        if (!dependsOn) {
            mcpLog.error('Missing required parameter: dependsOn');
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Dependency ID (dependsOn) is required'
                }
            };
        }

        mcpLog.info(`Adding dependency: task ${id} depends on ${dependsOn}, ProjectRoot: ${projectRoot}`);

        // Call the database-powered dependency addition
        const result = await addDependencyDb(
            userId,
            id,
            dependsOn,
            {
                tag
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
                message: result.message,
                taskId: result.taskId,
                dependencyId: result.dependencyId
            }
        };

    } catch (error) {
        mcpLog.error(`Error in addDependencyDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'ADD_DEPENDENCY_DB_ERROR',
                message: error.message || 'Unknown error adding dependency',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { addDependencyDb };