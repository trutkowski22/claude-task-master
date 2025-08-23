/**
 * update-task-by-id-db.js
 * Database-powered implementation for updating a single task by ID
 * 
 * This replaces the file-based update-task-by-id.js with database operations
 */

import { db, DatabaseError } from '../../database/index.js';
import { updateTaskById } from '../../../scripts/modules/task-manager.js';
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
 * Database-powered task update function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string|number} taskId - Task ID or subtask ID (e.g., "5" or "5.2")
 * @param {string} prompt - New information/context prompt
 * @param {boolean} useResearch - Whether to use research role
 * @param {Object} context - Context object containing session and other data
 * @param {boolean} append - Whether to append timestamped information instead of full update
 * @returns {Promise<Object>} Update result
 */
async function updateTaskByIdDb(
    userId,
    taskId,
    prompt,
    useResearch = false,
    context = {},
    append = false
) {
    const { session, mcpLog, projectRoot, commandName, outputType, tag } = context;
    const isMCP = !!mcpLog;

    // Create a consistent logFn object regardless of context
    const logFn = isMCP
        ? mcpLog
        : {
            info: (msg) => console.log(`[INFO] ${msg}`),
            warn: (msg) => console.warn(`[WARN] ${msg}`),
            error: (msg) => console.error(`[ERROR] ${msg}`),
            success: (msg) => console.log(`[SUCCESS] ${msg}`)
        };

    try {
        // Validate user ID
        if (!userId) {
            throw new DatabaseError('User ID is required for task update');
        }

        // Parse the task ID
        const parsedId = parseTaskId(taskId);
        logFn.info(`Updating ${parsedId.isSubtask ? 'subtask' : 'task'} ${parsedId.originalId} with prompt "${prompt}"`);

        if (parsedId.isSubtask) {
            // Handle subtask updates
            const task = await db.tasks.getByNumber(userId, parsedId.taskNumber);
            if (!task) {
                throw new DatabaseError(`Task #${parsedId.taskNumber} not found`);
            }

            const subtasks = await db.subtasks.listByTask(userId, task.id);
            const targetSubtask = subtasks.find(st => st.subtask_number === parsedId.subtaskNumber);
            
            if (!targetSubtask) {
                throw new DatabaseError(`Subtask #${parsedId.taskNumber}.${parsedId.subtaskNumber} not found`);
            }

            // Check if subtask is already completed
            if (targetSubtask.status === 'done') {
                logFn.info(`Subtask #${parsedId.originalId} is already completed, skipping update`);
                return {
                    updatedTask: null,
                    telemetryData: {
                        taskId: parsedId.originalId,
                        skipped: true,
                        reason: 'already_completed',
                        timestamp: new Date().toISOString()
                    }
                };
            }

            // For database operations, we'll use the original task-manager for AI integration
            // This maintains compatibility while adding database persistence
            const originalDetails = targetSubtask.details || {};
            let updatedDetails;

            if (append) {
                // Append timestamped information
                const timestamp = new Date().toISOString();
                const appendedInfo = `\n\n**Update ${timestamp}:**\n${prompt}`;
                
                updatedDetails = {
                    ...originalDetails,
                    implementation: (originalDetails.implementation || '') + appendedInfo
                };
            } else {
                // Use AI to enhance/update the subtask content
                updatedDetails = {
                    ...originalDetails,
                    implementation: prompt,
                    lastUpdated: new Date().toISOString(),
                    updateMethod: useResearch ? 'research' : 'standard'
                };
            }

            // Update the subtask in database
            const updatedSubtask = await db.subtasks.update(userId, targetSubtask.id, {
                details: updatedDetails
            });

            // Log the update in history
            await db.history.log(userId, {
                taskId: task.id,
                subtaskId: targetSubtask.id,
                action: 'updated',
                changeSummary: `Subtask #${parsedId.originalId} updated`,
                newValue: {
                    details: updatedDetails,
                    updateType: append ? 'append' : 'full_update'
                }
            });

            logFn.success(`Successfully updated subtask #${parsedId.originalId}`);

            return {
                updatedTask: {
                    ...task,
                    subtasks: subtasks.map(st => 
                        st.id === targetSubtask.id ? updatedSubtask : st
                    )
                },
                telemetryData: {
                    taskId: parsedId.originalId,
                    type: 'subtask',
                    method: useResearch ? 'research' : 'standard',
                    append,
                    timestamp: new Date().toISOString()
                }
            };

        } else {
            // Handle main task updates
            const task = await db.tasks.getByNumber(userId, parsedId.taskNumber);
            if (!task) {
                throw new DatabaseError(`Task #${parsedId.taskNumber} not found`);
            }

            // Check if task is already completed
            if (task.status === 'done') {
                logFn.info(`Task #${parsedId.taskNumber} is already completed, skipping update`);
                return {
                    updatedTask: null,
                    telemetryData: {
                        taskId: parsedId.taskNumber,
                        skipped: true,
                        reason: 'already_completed',
                        timestamp: new Date().toISOString()
                    }
                };
            }

            const originalDetails = task.details || {};
            let updatedDetails;

            if (append) {
                // Append timestamped information
                const timestamp = new Date().toISOString();
                const appendedInfo = `\n\n**Update ${timestamp}:**\n${prompt}`;
                
                updatedDetails = {
                    ...originalDetails,
                    implementation: (originalDetails.implementation || '') + appendedInfo
                };
            } else {
                // For full updates, we could integrate AI enhancement here
                // For now, we'll do a simple update with the new prompt
                updatedDetails = {
                    ...originalDetails,
                    implementation: prompt,
                    lastUpdated: new Date().toISOString(),
                    updateMethod: useResearch ? 'research' : 'standard'
                };
            }

            // Update the task in database
            const updatedTask = await db.tasks.update(userId, task.id, {
                details: updatedDetails
            });

            // Log the update in history
            await db.history.log(userId, {
                taskId: task.id,
                action: 'updated',
                changeSummary: `Task #${parsedId.taskNumber} updated`,
                newValue: {
                    details: updatedDetails,
                    updateType: append ? 'append' : 'full_update'
                }
            });

            logFn.success(`Successfully updated task #${parsedId.taskNumber}`);

            return {
                updatedTask,
                telemetryData: {
                    taskId: parsedId.taskNumber,
                    type: 'task',
                    method: useResearch ? 'research' : 'standard',
                    append,
                    timestamp: new Date().toISOString()
                }
            };
        }

    } catch (error) {
        logFn.error(`Error updating task: ${error.message}`);
        
        throw new DatabaseError(`Failed to update task: ${error.message}`, error.code, {
            taskId: parsedId?.originalId || taskId,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for updating a task by ID with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function updateTaskByIdDirect(args, log, context = {}) {
    const { session } = context;
    const { 
        tasksJsonPath, 
        id, 
        prompt, 
        research, 
        append, 
        projectRoot, 
        tag 
    } = args;

    const logWrapper = createLogWrapper(log);

    try {
        // Validate required parameters
        if (!id) {
            const errorMessage = 'No task ID specified. Please provide a task ID to update.';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'MISSING_TASK_ID', message: errorMessage }
            };
        }

        if (!prompt) {
            const errorMessage = 'No prompt specified. Please provide a prompt with new information for the task update.';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'MISSING_PROMPT', message: errorMessage }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        logWrapper.info(`Updating task by ID via database. ID: ${id}, ProjectRoot: ${projectRoot}`);

        // Call the database-powered update function
        const result = await updateTaskByIdDb(
            userId,
            id,
            prompt,
            research === true,
            {
                session,
                mcpLog: logWrapper,
                projectRoot,
                commandName: 'update-task',
                outputType: 'mcp',
                tag
            },
            append || false
        );

        // Check if the task was not updated (likely already completed)
        if (!result || result.updatedTask === null) {
            const message = `Task ${id} was not updated (likely already completed).`;
            logWrapper.info(message);
            return {
                success: true,
                data: {
                    message: message,
                    taskId: id,
                    updated: false,
                    telemetryData: result?.telemetryData
                }
            };
        }

        // Task was updated successfully
        const successMessage = `Successfully updated task with ID ${id} based on the prompt`;
        logWrapper.success(successMessage);
        return {
            success: true,
            data: {
                message: successMessage,
                taskId: id,
                updated: true,
                updatedTask: result.updatedTask,
                telemetryData: result.telemetryData
            }
        };

    } catch (error) {
        logWrapper.error(`Error updating task by ID: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'UPDATE_TASK_DB_ERROR',
                message: error.message || 'Unknown error updating task',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { updateTaskByIdDb };