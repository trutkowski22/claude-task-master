/**
 * update-subtask-by-id-db.js
 * Database-powered implementation for updating subtasks by ID
 * 
 * This replaces the file-based update-subtask-by-id.js with database operations
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
 * Parse subtask ID in format "5.2"
 * @param {string} subtaskId - Subtask ID in format "parentId.subtaskId"
 * @returns {Object} Parsed subtask ID information
 */
function parseSubtaskId(subtaskId) {
    if (typeof subtaskId !== 'string' || !subtaskId.includes('.')) {
        throw new DatabaseError(`Invalid subtask ID format: ${subtaskId}. Must be in format "parentId.subtaskId" (e.g., "5.2").`);
    }

    const [parentTaskNumber, subtaskNumber] = subtaskId.split('.');
    const parsedParentId = parseInt(parentTaskNumber, 10);
    const parsedSubtaskId = parseInt(subtaskNumber, 10);

    if (Number.isNaN(parsedParentId) || Number.isNaN(parsedSubtaskId)) {
        throw new DatabaseError(`Invalid subtask ID format: ${subtaskId}. Both parent and subtask IDs must be numeric.`);
    }

    return {
        parentTaskNumber: parsedParentId,
        subtaskNumber: parsedSubtaskId,
        originalId: subtaskId
    };
}

/**
 * Database-powered subtask update function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} subtaskId - Subtask ID in format "parentId.subtaskId"
 * @param {string} prompt - Information to append or update
 * @param {boolean} useResearch - Whether to use research role
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Update result
 */
async function updateSubtaskByIdDb(
    userId,
    subtaskId,
    prompt,
    useResearch = false,
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
            error: (msg) => console.error(`[ERROR] ${msg}`),
            success: (msg) => console.log(`[SUCCESS] ${msg}`)
        };

    try {
        // Validate user ID
        if (!userId) {
            throw new DatabaseError('User ID is required for subtask update');
        }

        // Parse subtask ID
        const parsedId = parseSubtaskId(subtaskId);
        const { parentTaskNumber, subtaskNumber, originalId } = parsedId;

        logFn.info(`Updating subtask ${originalId} with prompt "${prompt}" and research: ${useResearch}`);

        // Get parent task from database
        const parentTask = await db.tasks.getByNumber(userId, parentTaskNumber, projectId);
        if (!parentTask) {
            throw new DatabaseError(`Parent task #${parentTaskNumber} not found`);
        }

        // Get all subtasks for the parent task
        const subtasks = await db.subtasks.listByTask(userId, parentTask.id);
        const targetSubtask = subtasks.find(st => st.subtask_number === subtaskNumber);
        
        if (!targetSubtask) {
            throw new DatabaseError(`Subtask #${originalId} not found`);
        }

        // Check if subtask is already completed
        if (targetSubtask.status === 'done') {
            logFn.info(`Subtask #${originalId} is already completed, but proceeding with update`);
        }

        // Prepare updated details with timestamped information
        const currentDetails = targetSubtask.details || {};
        const timestamp = new Date().toISOString();
        
        // Append the new information with timestamp
        const updatedDetails = {
            ...currentDetails,
            implementation: (currentDetails.implementation || '') + `\n\n**Update ${timestamp}:**\n${prompt}`,
            lastUpdated: timestamp,
            updateMethod: useResearch ? 'research' : 'standard',
            updateCount: (currentDetails.updateCount || 0) + 1
        };

        // Update the subtask in database
        const updatedSubtask = await db.subtasks.update(userId, targetSubtask.id, {
            details: updatedDetails
        });

        // Log the update in history
        await db.history.log(userId, {
            taskId: parentTask.id,
            subtaskId: targetSubtask.id,
            action: 'updated',
            changeSummary: `Subtask #${originalId} updated with new information`,
            oldValue: {
                details: currentDetails,
                lastUpdateCount: currentDetails.updateCount || 0
            },
            newValue: {
                details: updatedDetails,
                updateMethod: useResearch ? 'research' : 'standard',
                newUpdateCount: updatedDetails.updateCount
            }
        });

        logFn.success(`Successfully updated subtask #${originalId}`);

        // Format the response to match expected API
        const formattedSubtask = {
            id: originalId,
            title: targetSubtask.title,
            description: targetSubtask.description,
            status: targetSubtask.status,
            details: updatedDetails,
            created_at: targetSubtask.created_at,
            updated_at: updatedSubtask.updated_at,
            parentTask: {
                id: parentTaskNumber,
                title: parentTask.title,
                status: parentTask.status
            }
        };

        return {
            updatedSubtask: formattedSubtask,
            telemetryData: {
                subtaskId: originalId,
                parentTaskId: parentTaskNumber,
                method: useResearch ? 'research' : 'standard',
                updateCount: updatedDetails.updateCount,
                timestamp: timestamp
            }
        };

    } catch (error) {
        logFn.error(`Error updating subtask: ${error.message}`);
        
        throw new DatabaseError(`Failed to update subtask: ${error.message}`, error.code, {
            subtaskId,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for updating subtasks by ID with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function updateSubtaskByIdDirect(args, log, context = {}) {
    const { session } = context;
    const { tasksJsonPath, id, prompt, research, projectRoot, tag } = args;

    const logWrapper = createLogWrapper(log);

    try {
        logWrapper.info(
            `Updating subtask by ID via direct function. ID: ${id}, ProjectRoot: ${projectRoot}`
        );

        // Basic validation for ID format (e.g., '5.2')
        if (!id || typeof id !== 'string' || !id.includes('.')) {
            const errorMessage =
                'Invalid subtask ID format. Must be in format "parentId.subtaskId" (e.g., "5.2").';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'INVALID_SUBTASK_ID', message: errorMessage }
            };
        }

        if (!prompt) {
            const errorMessage =
                'No prompt specified. Please provide the information to append.';
            logWrapper.error(errorMessage);
            return {
                success: false,
                error: { code: 'MISSING_PROMPT', message: errorMessage }
            };
        }

        // Extract user ID from context
        const userId = getUserId(context);

        const subtaskIdStr = String(id);
        const useResearch = research === true;

        logWrapper.info(
            `Updating subtask with ID ${subtaskIdStr} with prompt "${prompt}" and research: ${useResearch}`
        );

        // Call the database-powered update function
        const result = await updateSubtaskByIdDb(
            userId,
            subtaskIdStr,
            prompt,
            useResearch,
            null, // projectId - will be handled in Phase 2
            {
                mcpLog: logWrapper,
                session,
                projectRoot,
                tag,
                commandName: 'update-subtask',
                outputType: 'mcp'
            }
        );

        if (!result || result.updatedSubtask === null) {
            const message = `Subtask ${id} or its parent task not found.`;
            logWrapper.error(message);
            return {
                success: false,
                error: { code: 'SUBTASK_NOT_FOUND', message: message }
            };
        }

        // Subtask updated successfully
        const successMessage = `Successfully updated subtask with ID ${subtaskIdStr}`;
        logWrapper.success(successMessage);
        return {
            success: true,
            data: {
                message: successMessage,
                subtaskId: subtaskIdStr,
                parentId: subtaskIdStr.split('.')[0],
                subtask: result.updatedSubtask,
                useResearch,
                telemetryData: result.telemetryData,
                tagInfo: result.tagInfo
            }
        };

    } catch (error) {
        logWrapper.error(`Error in updateSubtaskByIdDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'UPDATE_SUBTASK_DB_ERROR',
                message: error.message || 'Unknown error updating subtask',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { updateSubtaskByIdDb };