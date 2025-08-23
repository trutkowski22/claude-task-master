/**
 * expand-task-db.js
 * Database-powered implementation for expanding a task into subtasks
 * 
 * This replaces the file-based expand-task.js with database operations
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
 * Database-powered task expansion function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {number} taskId - Task ID to expand
 * @param {Object} options - Expansion options
 * @param {number} options.numSubtasks - Number of subtasks to generate
 * @param {boolean} options.research - Enable research role for subtask generation
 * @param {string} options.prompt - Additional context to guide subtask generation
 * @param {boolean} options.force - Force expansion even if subtasks exist
 * @param {string} options.tag - Tag context
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Task expansion result
 */
async function expandTaskDb(
    userId,
    taskId,
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
            throw new DatabaseError('User ID is required for task expansion');
        }

        // Validate task ID
        if (!taskId || isNaN(taskId)) {
            throw new DatabaseError('Valid task ID is required');
        }

        const {
            numSubtasks,
            research = false,
            prompt = '',
            force = false,
            tag
        } = options;

        const taskNumber = parseInt(taskId, 10);

        logFn.info(`Expanding task ${taskNumber} into ${numSubtasks || 'default'} subtasks. Research: ${research}, Force: ${force}`);

        // Get the task to expand
        let taskToExpand;
        try {
            taskToExpand = await db.tasks.getByTaskNumber(userId, taskNumber);
            if (!taskToExpand) {
                throw new DatabaseError(`Task #${taskNumber} not found`);
            }
        } catch (error) {
            throw new DatabaseError(`Task #${taskNumber} not found: ${error.message}`);
        }

        // Check if task is completed
        if (taskToExpand.status === 'done' || taskToExpand.status === 'completed') {
            throw new DatabaseError(`Task #${taskNumber} is already marked as ${taskToExpand.status} and cannot be expanded`);
        }

        // Check for existing subtasks and force flag
        const existingSubtasks = taskToExpand.subtasks || [];
        const hasExistingSubtasks = existingSubtasks.length > 0;
        
        if (hasExistingSubtasks && !force) {
            logFn.info(`Task #${taskNumber} already has ${existingSubtasks.length} subtasks. Use force to overwrite.`);
            return {
                success: true,
                task: taskToExpand,
                subtasksAdded: 0,
                hasExistingSubtasks: true,
                message: `Task #${taskNumber} already has subtasks. Expansion skipped.`
            };
        }

        // If force flag is set, clear existing subtasks
        const subtasksCountBefore = hasExistingSubtasks ? existingSubtasks.length : 0;
        if (hasExistingSubtasks && force) {
            logFn.info(`Force flag set. Clearing existing subtasks for task #${taskNumber}.`);
            // In database version, we'll generate new subtasks and replace the old ones
        }

        // Generate subtasks using AI (this would integrate with the AI service)
        // For now, we'll simulate subtask generation based on the task content
        const generatedSubtasks = await generateSubtasksForTask(
            taskToExpand,
            {
                numSubtasks,
                research,
                prompt,
                logFn,
                session
            }
        );

        logFn.info(`Generated ${generatedSubtasks.length} subtasks for task #${taskNumber}`);

        // Update the task with new subtasks
        await db.tasks.update(userId, taskToExpand.id, {
            subtasks: generatedSubtasks,
            status: hasExistingSubtasks && force ? taskToExpand.status : 'in-progress' // Mark as in-progress if not already
        });

        // Get the updated task
        const updatedTask = await db.tasks.getByTaskNumber(userId, taskNumber);

        // Calculate how many subtasks were added
        const subtasksAdded = generatedSubtasks.length - (force ? 0 : subtasksCountBefore);

        // Log task expansion in history
        await db.history.log(userId, {
            action: 'task_expanded',
            changeSummary: `Task #${taskNumber} expanded with ${generatedSubtasks.length} subtasks`,
            taskId: taskToExpand.id,
            previousValue: {
                subtasks: existingSubtasks,
                subtaskCount: subtasksCountBefore
            },
            newValue: {
                subtasks: generatedSubtasks,
                subtaskCount: generatedSubtasks.length,
                expansionOptions: {
                    numSubtasks,
                    research,
                    prompt: prompt ? 'Custom prompt provided' : 'Default expansion',
                    force
                }
            }
        });

        const successMessage = `Successfully expanded task #${taskNumber} with ${subtasksAdded} new subtasks`;
        logFn.info(successMessage);

        return {
            success: true,
            task: updatedTask,
            subtasksAdded,
            hasExistingSubtasks,
            message: successMessage,
            telemetryData: {
                taskId: taskNumber,
                subtasksGenerated: generatedSubtasks.length,
                research,
                force
            }
        };

    } catch (error) {
        logFn.error(`Error expanding task: ${error.message}`);
        
        throw new DatabaseError(`Failed to expand task: ${error.message}`, error.code, {
            taskId,
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Generate subtasks for a task (AI integration placeholder)
 * In a full implementation, this would integrate with the AI service
 */
async function generateSubtasksForTask(task, options) {
    const { numSubtasks = 5, research, prompt, logFn } = options;
    
    // This is a placeholder implementation
    // In a real implementation, this would call the AI service to generate subtasks
    logFn.info(`Generating ${numSubtasks} subtasks for "${task.title}" (AI integration placeholder)`);
    
    const baseSubtasks = [
        {
            id: 1,
            title: `Analyze requirements for: ${task.title}`,
            description: `Break down and analyze the requirements for implementing ${task.title}`,
            status: 'pending',
            priority: task.priority || 'medium'
        },
        {
            id: 2,
            title: `Design implementation approach`,
            description: `Design the technical approach and architecture for ${task.title}`,
            status: 'pending',
            priority: task.priority || 'medium'
        },
        {
            id: 3,
            title: `Implement core functionality`,
            description: `Implement the main functionality for ${task.title}`,
            status: 'pending',
            priority: task.priority || 'high'
        },
        {
            id: 4,
            title: `Add error handling and validation`,
            description: `Implement proper error handling and input validation`,
            status: 'pending',
            priority: task.priority || 'medium'
        },
        {
            id: 5,
            title: `Write tests and documentation`,
            description: `Create unit tests and update documentation for ${task.title}`,
            status: 'pending',
            priority: task.priority || 'low'
        }
    ];

    // Return the requested number of subtasks
    const subtasks = baseSubtasks.slice(0, Math.max(1, Math.min(numSubtasks, 10)));
    
    // If custom prompt provided, modify first subtask to reflect it
    if (prompt && prompt.trim()) {
        subtasks[0].description += `. Additional context: ${prompt}`;
    }
    
    // If research enabled, add research focus to descriptions
    if (research) {
        subtasks.forEach(subtask => {
            subtask.description += ' (Include research-backed analysis)';
        });
    }
    
    return subtasks;
}

/**
 * Direct function wrapper for expanding tasks with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function expandTaskDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        id,
        num,
        research,
        prompt,
        force,
        projectRoot,
        tag,
        complexityReportPath
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        // Validate task ID
        const taskId = id ? parseInt(id, 10) : null;
        if (!taskId) {
            mcpLog.error('Task ID is required');
            return {
                success: false,
                error: {
                    code: 'INPUT_VALIDATION_ERROR',
                    message: 'Task ID is required'
                }
            };
        }

        // Process parameters
        const numSubtasks = num ? parseInt(num, 10) : undefined;
        const useResearch = research === true;
        const additionalContext = prompt || '';
        const forceFlag = force === true;

        mcpLog.info(`Expanding task ${taskId} from database, ProjectRoot: ${projectRoot}`);

        // Call the database-powered task expansion
        const result = await expandTaskDb(
            userId,
            taskId,
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
                projectRoot,
                complexityReportPath
            }
        );

        return {
            success: true,
            data: {
                task: result.task,
                subtasksAdded: result.subtasksAdded,
                hasExistingSubtasks: result.hasExistingSubtasks,
                telemetryData: result.telemetryData,
                message: result.message
            }
        };

    } catch (error) {
        mcpLog.error(`Error in expandTaskDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'EXPAND_TASK_DB_ERROR',
                message: error.message || 'Unknown error expanding task',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { expandTaskDb };