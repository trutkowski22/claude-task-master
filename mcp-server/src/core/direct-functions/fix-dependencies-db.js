/**
 * fix-dependencies-db.js
 * Database-powered implementation for fixing invalid task dependencies
 * 
 * This replaces the file-based fix-dependencies.js with database operations
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
 * Database-powered dependency fixing function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} options - Fix options
 * @param {string} options.tag - Tag context (optional)
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Dependency fixing result
 */
async function fixDependenciesDb(
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
            throw new DatabaseError('User ID is required for dependency fixing');
        }

        const { tag } = options;

        logFn.info('Fixing invalid task dependencies in database');

        // Get all tasks for the user
        const allTasks = await db.tasks.getAll(userId);
        
        if (!allTasks || allTasks.length === 0) {
            logFn.info('No tasks found to fix dependencies');
            return {
                success: true,
                fixed: 0,
                issues: [],
                message: 'No tasks found to fix dependencies'
            };
        }

        logFn.info(`Found ${allTasks.length} tasks to check for dependency issues`);

        const fixes = [];
        let totalFixed = 0;

        // Create a map of task IDs to task numbers for quick lookup
        const taskIdToNumberMap = new Map();
        const validTaskIds = new Set();
        
        allTasks.forEach(task => {
            taskIdToNumberMap.set(task.id, task.task_number);
            validTaskIds.add(task.id);
        });

        // Fix each task's dependencies
        for (const task of allTasks) {
            const originalDependencies = task.dependencies || [];
            
            if (originalDependencies.length === 0) {
                continue; // No dependencies to fix
            }
            
            let dependenciesChanged = false;
            const fixedDependencies = [];
            const removedDependencies = [];

            // Filter out invalid dependencies
            for (const depId of originalDependencies) {
                // Check if the dependency task exists
                if (!validTaskIds.has(depId)) {
                    removedDependencies.push({
                        id: depId,
                        reason: 'Task no longer exists'
                    });
                    dependenciesChanged = true;
                    continue;
                }
                
                // Check for self-dependency
                if (depId === task.id) {
                    removedDependencies.push({
                        id: depId,
                        taskNumber: task.task_number,
                        reason: 'Self-dependency (task cannot depend on itself)'
                    });
                    dependenciesChanged = true;
                    continue;
                }
                
                // Keep valid dependencies
                fixedDependencies.push(depId);
            }

            // Remove duplicates
            const uniqueDependencies = [...new Set(fixedDependencies)];
            if (uniqueDependencies.length !== fixedDependencies.length) {
                const duplicateCount = fixedDependencies.length - uniqueDependencies.length;
                removedDependencies.push({
                    reason: `Removed ${duplicateCount} duplicate dependencies`
                });
                dependenciesChanged = true;
            }

            // Check for circular dependencies and remove them
            const finalDependencies = [];
            for (const depId of uniqueDependencies) {
                const wouldCauseCycle = await wouldCreateCircularDependency(
                    userId, 
                    task.id, 
                    depId, 
                    taskIdToNumberMap, 
                    allTasks
                );
                
                if (wouldCauseCycle) {
                    const depTaskNumber = taskIdToNumberMap.get(depId);
                    removedDependencies.push({
                        id: depId,
                        taskNumber: depTaskNumber,
                        reason: `Would create circular dependency`
                    });
                    dependenciesChanged = true;
                } else {
                    finalDependencies.push(depId);
                }
            }

            // Update the task if dependencies changed
            if (dependenciesChanged) {
                await db.tasks.update(userId, task.id, {
                    dependencies: finalDependencies
                });
                
                const fix = {
                    taskNumber: task.task_number,
                    taskId: task.id,
                    originalDependencyCount: originalDependencies.length,
                    fixedDependencyCount: finalDependencies.length,
                    removedDependencies,
                    message: `Fixed dependencies for task #${task.task_number}: ${originalDependencies.length} → ${finalDependencies.length}`
                };
                
                fixes.push(fix);
                totalFixed++;
                
                logFn.info(`Fixed task #${task.task_number}: removed ${originalDependencies.length - finalDependencies.length} invalid dependencies`);
            }
        }

        const statusMessage = totalFixed > 0 
            ? `Fixed dependencies for ${totalFixed} task(s). Total issues resolved: ${fixes.reduce((sum, fix) => sum + fix.removedDependencies.length, 0)}.`
            : `No dependency issues found. All ${allTasks.length} tasks have valid dependencies.`;

        logFn.info(statusMessage);

        // Log dependency fixing in history
        await db.history.log(userId, {
            action: 'dependencies_fixed',
            changeSummary: `Dependency fixing completed: ${totalFixed} tasks fixed`,
            newValue: {
                tasksChecked: allTasks.length,
                tasksFixed: totalFixed,
                fixes: fixes.map(fix => ({
                    taskNumber: fix.taskNumber,
                    issuesFixed: fix.removedDependencies.length
                })),
                fixTimestamp: new Date().toISOString()
            }
        });

        return {
            success: true,
            fixed: totalFixed,
            tasksChecked: allTasks.length,
            fixes,
            message: statusMessage
        };

    } catch (error) {
        logFn.error(`Error fixing dependencies: ${error.message}`);
        
        throw new DatabaseError(`Failed to fix dependencies: ${error.message}`, error.code, {
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Check if adding a dependency would create a circular reference
 * @param {string} userId - User ID
 * @param {string} taskId - Task that would depend on depId
 * @param {string} depId - Potential dependency
 * @param {Map} taskIdToNumberMap - Map for logging
 * @param {Array} allTasks - All tasks for the user
 * @returns {Promise<boolean>} - True if it would create a cycle
 */
async function wouldCreateCircularDependency(userId, taskId, depId, taskIdToNumberMap, allTasks) {
    // Create a dependency map for efficient traversal
    const dependencyMap = new Map();
    allTasks.forEach(task => {
        dependencyMap.set(task.id, task.dependencies || []);
    });
    
    // Check if depId eventually depends on taskId
    const visited = new Set();
    const stack = [depId];
    
    while (stack.length > 0) {
        const currentId = stack.pop();
        
        if (visited.has(currentId)) {
            continue;
        }
        
        visited.add(currentId);
        
        // If we reach taskId while traversing dependencies of depId,
        // then adding taskId → depId would create a cycle
        if (currentId === taskId) {
            return true;
        }
        
        // Add all dependencies of current task to stack
        const deps = dependencyMap.get(currentId) || [];
        deps.forEach(depDepId => {
            if (!visited.has(depDepId)) {
                stack.push(depDepId);
            }
        });
    }
    
    return false;
}

/**
 * Direct function wrapper for fixing dependencies with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function fixDependenciesDirect(args, log, context = {}) {
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

        mcpLog.info(`Fixing invalid dependencies from database, ProjectRoot: ${projectRoot}`);

        // Call the database-powered dependency fixing
        const result = await fixDependenciesDb(
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
                fixed: result.fixed,
                tasksChecked: result.tasksChecked,
                fixes: result.fixes,
                tag: tag || 'master'
            }
        };

    } catch (error) {
        mcpLog.error(`Error in fixDependenciesDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'FIX_DEPENDENCIES_DB_ERROR',
                message: error.message || 'Unknown error fixing dependencies',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { fixDependenciesDb };