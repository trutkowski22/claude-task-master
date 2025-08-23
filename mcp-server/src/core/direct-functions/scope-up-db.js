/**
 * scope-up-db.js
 * Database-powered implementation for scoping up task complexity
 * 
 * This replaces the file-based scope-up.js with database operations
 */

import { z } from 'zod';
import { db, DatabaseError } from '../../database/index.js';
import { generateObjectService } from '../../../../scripts/modules/ai-services-unified.js';
import { getPromptManager } from '../../../../scripts/modules/prompt-manager.js';
import ContextGatherer from '../../../../scripts/modules/utils/contextGatherer.js';
import { createLogWrapper } from '../../tools/utils.js';

// Valid strength levels for scope adjustments
const VALID_STRENGTHS = ['light', 'regular', 'heavy'];

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
 * Validates strength parameter
 * @param {string} strength - The strength level to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateStrength(strength) {
    return VALID_STRENGTHS.includes(strength);
}

/**
 * Define Zod schema for scope-up AI response
 */
const ScopeUpResponseSchema = z.object({
    title: z.string().describe('Updated task title with increased scope'),
    description: z.string().describe('Updated task description reflecting increased complexity'),
    details: z.object({
        implementation: z.string().describe('Updated implementation details with expanded scope'),
        testStrategy: z.string().describe('Updated test strategy for increased complexity'),
        scopeChanges: z.array(z.string()).describe('List of specific changes made to increase scope')
    }),
    complexityIncrease: z.number().min(1).max(5).describe('Estimated complexity increase (1-5)'),
    reasoning: z.string().describe('Explanation of why these scope increases were made')
});

/**
 * Database-powered task scope-up function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} projectId - Project ID (optional)
 * @param {Array<number>} taskIds - Array of task numbers to scope up
 * @param {string} strength - Strength level ('light', 'regular', 'heavy')
 * @param {string} customPrompt - Optional custom instructions
 * @param {Object} context - Context object containing session and other data
 * @param {string} outputFormat - Output format (text or json)
 * @param {boolean} useResearch - Whether to use the research model
 * @returns {Promise<Object>} An object containing updatedTasks and telemetryData
 */
async function scopeUpTaskDb(
    userId,
    projectId = null,
    taskIds,
    strength = 'regular',
    customPrompt = null,
    context = {},
    outputFormat = 'text',
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
            throw new DatabaseError('User ID is required for scope-up operation');
        }

        // Validate strength
        if (!validateStrength(strength)) {
            throw new DatabaseError(
                `Invalid strength level: ${strength}. Must be one of: ${VALID_STRENGTHS.join(', ')}`
            );
        }

        // Validate task IDs
        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            throw new DatabaseError('Task IDs array is required and must not be empty');
        }

        logFn.info(`Scoping up ${taskIds.length} task(s) with strength: ${strength}`);

        const updatedTasks = [];
        let combinedTelemetryData = {
            method: 'ai',
            timestamp: new Date().toISOString(),
            commandName: commandName || 'scope-up',
            outputType: outputType || 'unknown',
            strength,
            taskCount: taskIds.length,
            useResearch,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            totalCost: 0
        };

        // Process each task
        for (const taskNumber of taskIds) {
            try {
                // Get task from database
                const task = await db.tasks.getByNumber(userId, taskNumber, projectId);
                
                logFn.info(`Processing task #${taskNumber}: ${task.title}`);

                // Gather project context for AI
                const contextGatherer = new ContextGatherer(projectRoot);
                const projectContext = await contextGatherer.gatherContext();

                // Get related tasks for context
                const relatedTasks = await db.tasks.list(userId, {
                    projectId,
                    status: ['pending', 'in-progress', 'review'],
                    limit: 10
                });

                // Get prompt template
                const promptManager = getPromptManager();
                const promptTemplate = await promptManager.getPrompt('scope-up-task');

                // Prepare AI generation context
                const aiContext = {
                    task: {
                        id: task.task_number,
                        title: task.title,
                        description: task.description,
                        details: task.details,
                        priority: task.priority,
                        status: task.status
                    },
                    strength,
                    customPrompt: customPrompt || '',
                    projectContext,
                    relatedTasks: relatedTasks.map(t => ({
                        id: t.task_number,
                        title: t.title,
                        description: t.description,
                        priority: t.priority
                    })),
                    useResearch
                };

                try {
                    // Generate scoped-up task using AI
                    const aiResult = await generateObjectService(
                        promptTemplate.template,
                        aiContext,
                        ScopeUpResponseSchema,
                        {
                            session,
                            projectRoot,
                            useResearch,
                            modelRole: useResearch ? 'research' : 'main'
                        }
                    );

                    // Update task in database
                    const updatedTask = await db.tasks.update(userId, task.id, {
                        title: aiResult.title,
                        description: aiResult.description,
                        details: {
                            ...task.details,
                            implementation: aiResult.details.implementation,
                            testStrategy: aiResult.details.testStrategy,
                            scopeChanges: aiResult.details.scopeChanges,
                            scopeUpHistory: [
                                ...(task.details.scopeUpHistory || []),
                                {
                                    timestamp: new Date().toISOString(),
                                    strength,
                                    complexityIncrease: aiResult.complexityIncrease,
                                    reasoning: aiResult.reasoning,
                                    customPrompt: customPrompt || null
                                }
                            ]
                        }
                    });

                    logFn.info(`Successfully scoped up task #${taskNumber} (complexity +${aiResult.complexityIncrease})`);

                    // Log task update in history
                    await db.history.log(userId, {
                        taskId: task.id,
                        action: 'scope_up',
                        changeSummary: `Task #${taskNumber} scoped up with ${strength} strength`,
                        oldValue: {
                            title: task.title,
                            description: task.description,
                            complexity: 'previous'
                        },
                        newValue: {
                            title: aiResult.title,
                            description: aiResult.description,
                            complexityIncrease: aiResult.complexityIncrease,
                            strength,
                            reasoning: aiResult.reasoning
                        }
                    });

                    // Add to updated tasks
                    updatedTasks.push({
                        id: taskNumber,
                        title: updatedTask.title,
                        description: updatedTask.description,
                        complexityIncrease: aiResult.complexityIncrease,
                        changes: aiResult.details.scopeChanges
                    });

                    // Update telemetry (AI service should provide token counts)
                    combinedTelemetryData.inputTokens += 0; // AI service integration needed
                    combinedTelemetryData.outputTokens += 0;
                    combinedTelemetryData.totalTokens += 0;
                    combinedTelemetryData.totalCost += 0;

                } catch (aiError) {
                    logFn.warn(`AI generation failed for task #${taskNumber}: ${aiError.message}`);
                    
                    // Fallback: Simple scope adjustment without AI
                    const scopeNote = `Scope increased (${strength}) - ${customPrompt || 'AI generation unavailable'}`;
                    
                    const updatedTask = await db.tasks.update(userId, task.id, {
                        details: {
                            ...task.details,
                            scopeUpHistory: [
                                ...(task.details.scopeUpHistory || []),
                                {
                                    timestamp: new Date().toISOString(),
                                    strength,
                                    note: scopeNote,
                                    fallback: true,
                                    customPrompt: customPrompt || null
                                }
                            ]
                        }
                    });

                    // Log fallback in history
                    await db.history.log(userId, {
                        taskId: task.id,
                        action: 'scope_up_fallback',
                        changeSummary: `Task #${taskNumber} scope-up fallback (AI failed)`,
                        newValue: { note: scopeNote, fallback: true }
                    });

                    updatedTasks.push({
                        id: taskNumber,
                        title: task.title,
                        fallback: true,
                        note: scopeNote
                    });

                    combinedTelemetryData.aiErrors = (combinedTelemetryData.aiErrors || 0) + 1;
                }

            } catch (taskError) {
                logFn.error(`Error processing task #${taskNumber}: ${taskError.message}`);
                
                // Continue with other tasks
                combinedTelemetryData.taskErrors = (combinedTelemetryData.taskErrors || 0) + 1;
                combinedTelemetryData.errorMessages = [
                    ...(combinedTelemetryData.errorMessages || []),
                    `Task #${taskNumber}: ${taskError.message}`
                ];
            }
        }

        combinedTelemetryData.success = true;
        combinedTelemetryData.tasksProcessed = updatedTasks.length;

        if (outputFormat === 'text') {
            logFn.info(`Successfully scoped up ${updatedTasks.length} task(s)`);
        }

        return {
            updatedTasks,
            telemetryData: combinedTelemetryData
        };

    } catch (error) {
        logFn.error(`Error in scopeUpTaskDb: ${error.message}`);
        
        // Update telemetry with error
        const errorTelemetry = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            commandName: commandName || 'scope-up',
            outputType: outputType || 'unknown'
        };

        throw new DatabaseError(`Failed to scope up tasks: ${error.message}`, error.code, {
            telemetryData: errorTelemetry
        });
    }
}

/**
 * Direct function wrapper for scoping up task complexity with database operations
 * 
 * This is the main entry point that replaces the file-based scopeUpDirect function
 */
export async function scopeUpDirect(args, log, context = {}) {
    const {
        id,
        strength = 'regular',
        prompt: customPrompt,
        research = false,
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

        // Check required parameters
        if (!id) {
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'The id parameter is required for scoping up tasks'
                }
            };
        }

        // Parse task IDs - convert to numbers
        const taskIds = id.split(',').map((taskId) => parseInt(taskId.trim(), 10));

        // Validate all task IDs are numbers
        for (const taskId of taskIds) {
            if (isNaN(taskId)) {
                return {
                    success: false,
                    error: {
                        code: 'INVALID_PARAMETER',
                        message: `Invalid task ID: ${taskId}. Task IDs must be numbers.`
                    }
                };
            }
        }

        log.info(`Scoping up tasks: ${taskIds.join(', ')}, strength: ${strength}, research: ${research}`);

        // Call the database-powered scope-up function
        const result = await scopeUpTaskDb(
            userId,
            projectId,
            taskIds,
            strength,
            customPrompt,
            {
                session,
                mcpLog,
                projectRoot,
                commandName: 'scope-up',
                outputType: 'mcp',
                tag
            },
            'json',
            research || false
        );

        return {
            success: true,
            data: {
                updatedTasks: result.updatedTasks,
                tasksUpdated: result.updatedTasks.length,
                message: `Successfully scoped up ${result.updatedTasks.length} task(s)`,
                telemetryData: result.telemetryData
            }
        };

    } catch (error) {
        log.error(`Error in scopeUpDirect: ${error.message}`);
        
        return {
            success: false,
            error: {
                code: error.code || 'SCOPE_UP_ERROR',
                message: error.message,
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { scopeUpTaskDb };