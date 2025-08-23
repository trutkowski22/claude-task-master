/**
 * validate-dependencies-db.js
 * Database-powered implementation for validating task dependencies
 * 
 * This replaces the file-based validate-dependencies.js with database operations
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
 * Database-powered dependency validation function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} options - Validation options
 * @param {string} options.tag - Tag context (optional)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Dependency validation result
 */
async function validateDependenciesDb(
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
            throw new DatabaseError('User ID is required for dependency validation');
        }

        const { tag } = options;

        logFn.info('Validating task dependencies from database');

        // Get all tasks for the user
        const allTasks = await db.tasks.getAll(userId);
        
        if (!allTasks || allTasks.length === 0) {
            logFn.info('No tasks found to validate dependencies');
            return {
                success: true,
                issues: [],
                tasksChecked: 0,
                message: 'No tasks found to validate dependencies'
            };
        }

        logFn.info(`Found ${allTasks.length} tasks to validate dependencies`);

        const issues = [];
        let tasksWithDependencies = 0;

        // Create a map of task IDs to task numbers for quick lookup
        const taskIdToNumberMap = new Map();
        const taskNumberToIdMap = new Map();
        
        allTasks.forEach(task => {
            taskIdToNumberMap.set(task.id, task.task_number);
            taskNumberToIdMap.set(task.task_number, task.id);
        });

        // Check each task's dependencies
        for (const task of allTasks) {
            const dependencies = task.dependencies || [];
            
            if (dependencies.length === 0) {
                continue; // No dependencies to validate
            }
            
            tasksWithDependencies++;
            
            // Check each dependency
            for (const depId of dependencies) {
                // Check if the dependency task exists
                if (!taskIdToNumberMap.has(depId)) {
                    issues.push({
                        type: 'missing_dependency',
                        taskNumber: task.task_number,
                        taskId: task.id,
                        dependencyId: depId,
                        message: `Task #${task.task_number} depends on non-existent task (ID: ${depId})`
                    });
                    continue;
                }
                
                const depTaskNumber = taskIdToNumberMap.get(depId);
                
                // Check for self-dependency
                if (depId === task.id) {
                    issues.push({
                        type: 'self_dependency',
                        taskNumber: task.task_number,
                        taskId: task.id,
                        dependencyId: depId,
                        dependencyTaskNumber: depTaskNumber,
                        message: `Task #${task.task_number} depends on itself`
                    });
                }
            }
            
            // Check for circular dependencies
            const circularPath = await detectCircularDependency(userId, task.id, taskIdToNumberMap, new Set(), [task.task_number]);
            if (circularPath.length > 0) {
                issues.push({
                    type: 'circular_dependency',
                    taskNumber: task.task_number,
                    taskId: task.id,
                    circularPath,
                    message: `Task #${task.task_number} has circular dependency: ${circularPath.join(' → ')}`
                });
            }
        }

        // Check for duplicate dependencies
        for (const task of allTasks) {
            const dependencies = task.dependencies || [];
            
            if (dependencies.length <= 1) {
                continue; // Can't have duplicates with 0 or 1 dependency
            }
            
            const uniqueDeps = new Set(dependencies);
            if (uniqueDeps.size !== dependencies.length) {
                const duplicates = dependencies.filter((dep, index) => 
                    dependencies.indexOf(dep) !== index
                ).map(depId => taskIdToNumberMap.get(depId));
                
                issues.push({
                    type: 'duplicate_dependency',
                    taskNumber: task.task_number,
                    taskId: task.id,
                    duplicates,
                    message: `Task #${task.task_number} has duplicate dependencies: ${duplicates.join(', ')}`
                });
            }
        }

        const issueCount = issues.length;
        const issueTypes = [...new Set(issues.map(issue => issue.type))];

        let statusMessage;
        if (issueCount === 0) {
            statusMessage = `Dependencies validation passed. Checked ${allTasks.length} tasks (${tasksWithDependencies} with dependencies).`;
            logFn.info(statusMessage);
        } else {
            statusMessage = `Dependencies validation found ${issueCount} issue(s) across ${allTasks.length} tasks. Issue types: ${issueTypes.join(', ')}.`;
            logFn.warn(statusMessage);
            
            // Log each issue
            issues.forEach(issue => {
                logFn.warn(`  - ${issue.message}`);
            });
        }

        // Log dependency validation in history
        await db.history.log(userId, {
            action: 'dependencies_validated',
            changeSummary: `Dependency validation completed: ${issueCount} issues found`,
            newValue: {
                tasksChecked: allTasks.length,
                tasksWithDependencies,
                issueCount,
                issueTypes,
                validationTimestamp: new Date().toISOString()
            }
        });

        return {
            success: true,
            issues,
            issueCount,
            issueTypes,
            tasksChecked: allTasks.length,
            tasksWithDependencies,
            message: statusMessage
        };

    } catch (error) {
        logFn.error(`Error validating dependencies: ${error.message}`);
        
        throw new DatabaseError(`Failed to validate dependencies: ${error.message}`, error.code, {
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Detect circular dependencies using depth-first search
 * @param {string} userId - User ID
 * @param {string} taskId - Current task ID being checked
 * @param {Map} taskIdToNumberMap - Map of task IDs to task numbers
 * @param {Set} visited - Set of visited task IDs in current path
 * @param {Array} path - Current dependency path (task numbers for readability)
 * @returns {Promise<Array>} - Empty array if no circular dependency, otherwise the circular path
 */
async function detectCircularDependency(userId, taskId, taskIdToNumberMap, visited = new Set(), path = []) {
    // If we've already visited this task in the current path, we have a cycle
    if (visited.has(taskId)) {
        const cycleStartIndex = path.indexOf(taskIdToNumberMap.get(taskId));
        return cycleStartIndex >= 0 ? path.slice(cycleStartIndex).concat([taskIdToNumberMap.get(taskId)]) : path;
    }
    
    // Add current task to visited set and path
    visited.add(taskId);
    
    try {
        // Get the task to check its dependencies
        const task = await db.tasks.getById(userId, taskId);
        if (!task || !task.dependencies) {
            visited.delete(taskId);
            return [];
        }
        
        // Check each dependency
        for (const depId of task.dependencies) {
            const depTaskNumber = taskIdToNumberMap.get(depId);
            if (!depTaskNumber) {
                continue; // Skip non-existent dependencies (handled elsewhere)
            }
            
            const newPath = [...path, depTaskNumber];
            const circularPath = await detectCircularDependency(userId, depId, taskIdToNumberMap, new Set(visited), newPath);
            
            if (circularPath.length > 0) {
                return circularPath;
            }
        }
        
        // Remove from visited when backtracking
        visited.delete(taskId);
        return [];
        
    } catch (error) {
        // If we can't get the task, assume no circular dependency for this branch
        visited.delete(taskId);
        return [];
    }
}

/**
 * Direct function wrapper for validating dependencies with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function validateDependenciesDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        projectRoot,
        tag
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        mcpLog.info(`Validating dependencies from database, ProjectRoot: ${projectRoot}`);

        // Call the database-powered dependency validation
        const result = await validateDependenciesDb(
            userId,
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
                issues: result.issues,
                issueCount: result.issueCount,
                issueTypes: result.issueTypes,
                tasksChecked: result.tasksChecked,
                tasksWithDependencies: result.tasksWithDependencies
            }
        };

    } catch (error) {
        mcpLog.error(`Error in validateDependenciesDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'VALIDATE_DEPENDENCIES_DB_ERROR',
                message: error.message || 'Unknown error validating dependencies',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { validateDependenciesDb };