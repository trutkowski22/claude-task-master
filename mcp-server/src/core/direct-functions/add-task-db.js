/**
 * add-task-db.js
 * Database-powered implementation for adding a new task
 * 
 * This replaces the file-based add-task.js with database operations
 */

import { z } from 'zod';
import Fuse from 'fuse.js';
import { db, DatabaseError } from '../../database/index.js';
import { generateObjectService } from '../../../../scripts/modules/ai-services-unified.js';
import { getDefaultPriority } from '../../../../scripts/modules/config-manager.js';
import { getPromptManager } from '../../../../scripts/modules/prompt-manager.js';
import ContextGatherer from '../../../../scripts/modules/utils/contextGatherer.js';
import { createLogWrapper } from '../../tools/utils.js';
import {
    TASK_PRIORITY_OPTIONS,
    DEFAULT_TASK_PRIORITY,
    isValidTaskPriority,
    normalizeTaskPriority
} from '../../../../src/constants/task-priority.js';

// Define Zod schema for the expected AI output object
const AiTaskDataSchema = z.object({
    title: z.string().describe('Clear, concise title for the task'),
    description: z
        .string()
        .describe('A one or two sentence description of the task'),
    details: z
        .string()
        .describe('In-depth implementation details, considerations, and guidance'),
    testStrategy: z
        .string()
        .describe('Detailed approach for verifying task completion'),
    dependencies: z
        .array(z.number())
        .nullable()
        .describe(
            'Array of task IDs that this task depends on (must be completed before this task can start)'
        )
});

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
 * Get all tasks for similarity checking
 * @param {string} userId - User ID
 * @param {string} projectId - Project ID (optional)
 * @returns {Promise<Array>} Array of all tasks
 */
async function getAllTasks(userId, projectId = null) {
    try {
        const tasks = await db.tasks.list(userId, {
            projectId,
            // Get all tasks regardless of status for similarity checking
        });
        return tasks;
    } catch (error) {
        console.warn('Error fetching tasks for similarity check:', error.message);
        return [];
    }
}

/**
 * Check for similar tasks using fuzzy search
 * @param {string} title - New task title
 * @param {string} description - New task description
 * @param {Array} existingTasks - Array of existing tasks
 * @returns {Array} Array of similar tasks
 */
function findSimilarTasks(title, description, existingTasks) {
    if (!existingTasks.length) return [];

    const searchText = `${title} ${description}`.toLowerCase();
    
    const fuse = new Fuse(existingTasks, {
        keys: ['title', 'description'],
        threshold: 0.4, // Adjust similarity threshold
        includeScore: true
    });

    const results = fuse.search(searchText);
    return results
        .filter(result => result.score < 0.6) // Only include good matches
        .map(result => ({
            ...result.item,
            similarity: (1 - result.score) * 100 // Convert to percentage
        }));
}

/**
 * Database-powered task creation function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} projectId - Project ID (optional)
 * @param {string} prompt - Description of the task to add (required for AI-driven creation)
 * @param {Array} dependencies - Task dependencies
 * @param {string} priority - Task priority
 * @param {Object} context - Context object containing session and other data
 * @param {string} outputFormat - Output format (text or json)
 * @param {Object} manualTaskData - Manual task data (optional, for direct task creation without AI)
 * @param {boolean} useResearch - Whether to use the research model
 * @returns {Promise<Object>} An object containing newTaskId and telemetryData
 */
async function addTaskDb(
    userId,
    projectId = null,
    prompt,
    dependencies = [],
    priority = null,
    context = {},
    outputFormat = 'text',
    manualTaskData = null,
    useResearch = false
) {
    const { session, mcpLog, projectRoot, commandName, outputType, tag } = context;
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
            throw new DatabaseError('User ID is required for task creation');
        }

        // Get the next task number
        const nextTaskNumber = await db.tasks.getNextNumber(userId, projectId);

        // Normalize and validate priority
        const taskPriority = normalizeTaskPriority(priority) || getDefaultPriority() || DEFAULT_TASK_PRIORITY;
        if (!isValidTaskPriority(taskPriority)) {
            throw new DatabaseError(`Invalid task priority: ${taskPriority}`);
        }

        // Validate dependencies
        const validatedDependencies = [];
        if (dependencies && dependencies.length > 0) {
            for (const depId of dependencies) {
                try {
                    const depTask = await db.tasks.getByNumber(userId, depId, projectId);
                    validatedDependencies.push(depTask.id);
                } catch (error) {
                    logFn.warn(`Dependency task #${depId} not found, skipping`);
                }
            }
        }

        let taskData;
        let telemetryData = {
            method: manualTaskData ? 'manual' : 'ai',
            timestamp: new Date().toISOString(),
            commandName: commandName || 'add-task',
            outputType: outputType || 'unknown',
            priority: taskPriority,
            dependenciesCount: validatedDependencies.length,
            useResearch
        };

        if (manualTaskData) {
            // Manual task creation
            taskData = {
                title: manualTaskData.title,
                description: manualTaskData.description,
                details: {
                    implementation: manualTaskData.details || '',
                    testStrategy: manualTaskData.testStrategy || '',
                    manuallyCreated: true
                }
            };

            logFn.info(`Creating manual task: "${taskData.title}"`);
        } else {
            // AI-driven task creation
            if (!prompt) {
                throw new DatabaseError('Prompt is required for AI-driven task creation');
            }

            logFn.info(`Creating AI task from prompt: "${prompt}"`);

            // Get existing tasks for context
            const existingTasks = await getAllTasks(userId, projectId);
            
            // Prepare context for AI
            const contextGatherer = new ContextGatherer(projectRoot);
            const projectContext = await contextGatherer.gatherContext();

            // Get prompt template
            const promptManager = getPromptManager();
            const promptTemplate = await promptManager.getPrompt('add-task');

            // Prepare AI generation context
            const aiContext = {
                prompt,
                existingTasks: existingTasks.map(t => ({
                    id: t.task_number,
                    title: t.title,
                    description: t.description,
                    status: t.status
                })),
                projectContext,
                priority: taskPriority,
                useResearch
            };

            try {
                // Generate task using AI
                const aiResult = await generateObjectService(
                    promptTemplate.template,
                    aiContext,
                    AiTaskDataSchema,
                    {
                        session,
                        projectRoot,
                        useResearch,
                        modelRole: useResearch ? 'research' : 'main'
                    }
                );

                taskData = {
                    title: aiResult.title,
                    description: aiResult.description,
                    details: {
                        implementation: aiResult.details,
                        testStrategy: aiResult.testStrategy,
                        aiGenerated: true,
                        originalPrompt: prompt
                    }
                };

                // Add AI-suggested dependencies if any
                if (aiResult.dependencies && aiResult.dependencies.length > 0) {
                    for (const depId of aiResult.dependencies) {
                        try {
                            const depTask = await db.tasks.getByNumber(userId, depId, projectId);
                            if (!validatedDependencies.includes(depTask.id)) {
                                validatedDependencies.push(depTask.id);
                            }
                        } catch (error) {
                            logFn.warn(`AI suggested dependency #${depId} not found, skipping`);
                        }
                    }
                }

                telemetryData.aiGenerationSuccess = true;
                telemetryData.aiSuggestedDependencies = aiResult.dependencies?.length || 0;

            } catch (aiError) {
                logFn.warn(`AI generation failed: ${aiError.message}, creating basic task`);
                
                // Fallback to basic task creation
                taskData = {
                    title: prompt.slice(0, 100), // Use prompt as title, truncated
                    description: prompt,
                    details: {
                        implementation: 'Task created from prompt. Details to be added.',
                        testStrategy: 'Testing strategy to be defined.',
                        aiFallback: true,
                        originalPrompt: prompt
                    }
                };

                telemetryData.aiGenerationSuccess = false;
                telemetryData.aiError = aiError.message;
            }
        }

        // Check for similar tasks
        const allTasks = await getAllTasks(userId, projectId);
        const similarTasks = findSimilarTasks(taskData.title, taskData.description, allTasks);
        
        if (similarTasks.length > 0) {
            logFn.info(`Found ${similarTasks.length} similar tasks`);
            telemetryData.similarTasksFound = similarTasks.length;
        }

        // Create the task in database
        const newTask = await db.tasks.create(userId, {
            projectId,
            taskNumber: null, // Let database auto-assign
            title: taskData.title,
            description: taskData.description,
            priority: taskPriority,
            status: 'pending',
            details: taskData.details
        });

        logFn.info(`Created task #${newTask.task_number} with ID: ${newTask.id}`);

        // Add dependencies if any
        if (validatedDependencies.length > 0) {
            for (const depTaskId of validatedDependencies) {
                try {
                    await db.dependencies.add(userId, newTask.id, depTaskId);
                    logFn.info(`Added dependency: task #${newTask.task_number} depends on task ID ${depTaskId}`);
                } catch (depError) {
                    logFn.warn(`Failed to add dependency: ${depError.message}`);
                }
            }
        }

        // Handle tag assignment
        let tagInfo = null;
        if (tag) {
            try {
                // Get or create tag
                let tagObj;
                try {
                    tagObj = await db.tags.getByName(userId, tag);
                } catch (error) {
                    // Tag doesn't exist, create it
                    tagObj = await db.tags.create(userId, { name: tag });
                    logFn.info(`Created new tag: ${tag}`);
                }

                // Add tag to task
                await db.tags.addToTask(userId, newTask.id, tagObj.id);
                tagInfo = {
                    name: tag,
                    id: tagObj.id,
                    action: 'assigned'
                };
                logFn.info(`Assigned tag "${tag}" to task #${newTask.task_number}`);

            } catch (tagError) {
                logFn.warn(`Failed to assign tag "${tag}": ${tagError.message}`);
                tagInfo = {
                    name: tag,
                    error: tagError.message
                };
            }
        }

        // Log task creation in history
        await db.history.log(userId, {
            taskId: newTask.id,
            action: 'created',
            changeSummary: `Task #${newTask.task_number} created: ${newTask.title}`,
            newValue: {
                title: newTask.title,
                description: newTask.description,
                priority: newTask.priority,
                method: manualTaskData ? 'manual' : 'ai'
            }
        });

        // Update telemetry
        telemetryData.success = true;
        telemetryData.taskId = newTask.task_number;
        telemetryData.actualDependencies = validatedDependencies.length;
        telemetryData.tagAssigned = !!tagInfo;

        return {
            newTaskId: newTask.task_number,
            taskUuid: newTask.id,
            telemetryData,
            tagInfo,
            similarTasks: similarTasks.length > 0 ? similarTasks : undefined
        };

    } catch (error) {
        logFn.error(`Error creating task: ${error.message}`);
        
        // Update telemetry with error
        const errorTelemetry = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            commandName: commandName || 'add-task',
            outputType: outputType || 'unknown'
        };

        throw new DatabaseError(`Failed to create task: ${error.message}`, error.code, {
            telemetryData: errorTelemetry
        });
    }
}

/**
 * Direct function wrapper for adding a new task with database operations
 * 
 * This is the main entry point that replaces the file-based addTaskDirect function
 */
export async function addTaskDirect(args, log, context = {}) {
    const {
        prompt,
        title,
        description,
        details,
        testStrategy,
        dependencies,
        priority,
        research,
        projectRoot,
        tag,
        projectId // New parameter for multi-project support
    } = args;

    const { session } = context;

    // Create logger wrapper
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context (will be from JWT in Phase 2)
        const userId = getUserId(context);

        // Check if this is manual task creation or AI-driven task creation
        const isManualCreation = title && description;

        // Validate required parameters
        if (!prompt && !isManualCreation) {
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Either the prompt parameter or both title and description parameters are required for adding a task'
                }
            };
        }

        // Parse dependencies
        const taskDependencies = Array.isArray(dependencies)
            ? dependencies
            : dependencies
                ? String(dependencies)
                    .split(',')
                    .map((id) => parseInt(id.trim(), 10))
                    .filter(id => !isNaN(id))
                : [];

        // Prepare manual task data if applicable
        let manualTaskData = null;
        if (isManualCreation) {
            manualTaskData = {
                title,
                description,
                details: details || '',
                testStrategy: testStrategy || ''
            };
        }

        // Call the database-powered task creation
        const result = await addTaskDb(
            userId,
            projectId,
            prompt,
            taskDependencies,
            priority,
            {
                session,
                mcpLog,
                projectRoot,
                commandName: 'add-task',
                outputType: 'mcp',
                tag
            },
            'json',
            manualTaskData,
            research || false
        );

        return {
            success: true,
            data: {
                taskId: result.newTaskId,
                taskUuid: result.taskUuid,
                message: `Successfully added new task #${result.newTaskId}`,
                telemetryData: result.telemetryData,
                tagInfo: result.tagInfo,
                similarTasks: result.similarTasks
            }
        };

    } catch (error) {
        log.error(`Error in addTaskDirect: ${error.message}`);
        
        return {
            success: false,
            error: {
                code: error.code || 'ADD_TASK_ERROR',
                message: error.message,
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { addTaskDb };