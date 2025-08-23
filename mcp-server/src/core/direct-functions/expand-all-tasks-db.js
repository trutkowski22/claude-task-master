/**
 * expand-all-tasks-db.js
 * Database-powered implementation for expanding all tasks with subtasks
 * 
 * This replaces the file-based expand-all-tasks.js with database operations
 */

import { db, DatabaseError } from '../../database/index.js';
import { createLogWrapper } from '../../tools/utils.js';
import { expandTaskDb } from './expand-task-db.js';

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
 * Database-powered expand all tasks function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} options - Expansion options
 * @param {number} options.numSubtasks - Number of subtasks to generate
 * @param {boolean} options.research - Enable research role for subtask generation
 * @param {string} options.prompt - Additional context to guide subtask generation
 * @param {boolean} options.force - Force expansion even if subtasks exist
 * @param {string} options.tag - Tag context
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Expand all tasks result
 */
async function expandAllTasksDb(
    userId,
    options = {},
    projectId = null,
    context = {}
) {
    const { mcpLog, session } = context;
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
            throw new DatabaseError('User ID is required for expanding all tasks');
        }

        const {
            numSubtasks,
            research = false,
            prompt = '',
            force = false,
            tag
        } = options;

        logFn.info(`Expanding all pending tasks. Subtasks: ${numSubtasks || 'default'}, Research: ${research}, Force: ${force}`);

        // Get all tasks for the user
        const allTasks = await db.tasks.getAll(userId);
        
        if (!allTasks || allTasks.length === 0) {
            logFn.info('No tasks found to expand');
            return {
                success: true,
                expandedCount: 0,
                failedCount: 0,
                skippedCount: 0,
                tasksToExpand: 0,
                message: 'No tasks found to expand'
            };
        }

        // Filter tasks that should be expanded
        const tasksToExpand = allTasks.filter(task => {
            // Skip completed tasks
            if (task.status === 'done' || task.status === 'completed') {
                return false;
            }
            
            // If force is false, skip tasks that already have subtasks
            if (!force && task.subtasks && task.subtasks.length > 0) {
                return false;
            }
            
            return true;
        });

        logFn.info(`Found ${tasksToExpand.length} tasks out of ${allTasks.length} total that can be expanded`);

        let expandedCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        const expansionResults = [];
        const telemetryData = {
            totalTasks: allTasks.length,
            tasksEligibleForExpansion: tasksToExpand.length,
            expansions: []
        };

        // Expand each eligible task
        for (const task of tasksToExpand) {
            try {
                logFn.info(`Expanding task #${task.task_number}: ${task.title}`);
                
                // Use the same expansion logic as single task expansion
                const expansionResult = await expandTaskDb(
                    userId,
                    task.task_number,
                    {
                        numSubtasks,
                        research,
                        prompt,
                        force,
                        tag
                    },
                    projectId,
                    {
                        mcpLog,
                        session
                    }
                );

                if (expansionResult.success) {
                    if (expansionResult.subtasksAdded > 0) {
                        expandedCount++;
                        expansionResults.push({
                            taskNumber: task.task_number,
                            title: task.title,
                            subtasksAdded: expansionResult.subtasksAdded,
                            status: 'expanded'
                        });
                        
                        // Add to telemetry
                        telemetryData.expansions.push({
                            taskId: task.task_number,
                            subtasksGenerated: expansionResult.subtasksAdded,
                            research,
                            force
                        });
                        
                        logFn.info(`Successfully expanded task #${task.task_number} with ${expansionResult.subtasksAdded} subtasks`);
                    } else {
                        skippedCount++;
                        expansionResults.push({
                            taskNumber: task.task_number,
                            title: task.title,
                            subtasksAdded: 0,
                            status: 'skipped',
                            reason: 'Already has subtasks'
                        });
                        logFn.info(`Skipped task #${task.task_number} - already has subtasks`);
                    }
                } else {
                    failedCount++;
                    expansionResults.push({
                        taskNumber: task.task_number,
                        title: task.title,
                        status: 'failed',
                        error: expansionResult.message || 'Unknown error'
                    });
                    logFn.error(`Failed to expand task #${task.task_number}: ${expansionResult.message}`);
                }
                
            } catch (error) {
                failedCount++;
                expansionResults.push({
                    taskNumber: task.task_number,
                    title: task.title,
                    status: 'failed',
                    error: error.message
                });
                logFn.error(`Error expanding task #${task.task_number}: ${error.message}`);
            }
        }

        // Calculate skipped tasks (those with existing subtasks when force=false)
        const tasksWithExistingSubtasks = allTasks.filter(task => 
            !force && 
            task.subtasks && 
            task.subtasks.length > 0 &&
            task.status !== 'done' && 
            task.status !== 'completed'
        ).length;

        skippedCount += tasksWithExistingSubtasks;

        // Log expand all operation in history
        await db.history.log(userId, {
            action: 'expand_all_tasks',
            changeSummary: `Expanded all tasks: ${expandedCount} expanded, ${failedCount} failed, ${skippedCount} skipped`,
            newValue: {
                totalTasks: allTasks.length,
                tasksToExpand: tasksToExpand.length,
                expandedCount,
                failedCount,
                skippedCount,
                expansionOptions: {
                    numSubtasks,
                    research,
                    prompt: prompt ? 'Custom prompt provided' : 'Default expansion',
                    force
                },
                results: expansionResults
            }
        });

        const successMessage = `Expand all operation completed. Expanded: ${expandedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}`;
        logFn.info(successMessage);

        return {
            success: true,
            expandedCount,
            failedCount,
            skippedCount,
            tasksToExpand: tasksToExpand.length,
            results: expansionResults,
            telemetryData,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error expanding all tasks: ${error.message}`);
        
        throw new DatabaseError(`Failed to expand all tasks: ${error.message}`, error.code, {
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for expanding all tasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function expandAllTasksDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        num,
        research,
        prompt,
        force,
        projectRoot,
        tag
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Parse parameters (ensure correct types)
        const numSubtasks = num ? parseInt(num, 10) : undefined;
        const useResearch = research === true;
        const additionalContext = prompt || '';
        const forceFlag = force === true;

        mcpLog.info(`Expanding all tasks from database. Subtasks: ${numSubtasks || 'default'}, Research: ${useResearch}, Force: ${forceFlag}, ProjectRoot: ${projectRoot}`);

        // Call the database-powered expand all tasks
        const result = await expandAllTasksDb(
            userId,
            {
                numSubtasks,
                research: useResearch,
                prompt: additionalContext,
                force: forceFlag,
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
                details: {
                    expandedCount: result.expandedCount,
                    failedCount: result.failedCount,
                    skippedCount: result.skippedCount,
                    tasksToExpand: result.tasksToExpand,
                    results: result.results
                },
                telemetryData: result.telemetryData
            }
        };

    } catch (error) {
        mcpLog.error(`Error in expandAllTasksDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'EXPAND_ALL_TASKS_DB_ERROR',
                message: error.message || 'Unknown error expanding all tasks',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { expandAllTasksDb };