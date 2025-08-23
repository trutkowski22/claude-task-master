/**
 * parse-prd-db.js
 * Database-powered implementation for parsing PRD documents and generating tasks
 *
 * This replaces the file-based parse-prd.js with database operations
 */

import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { db, DatabaseError } from '../../database/index.js';
import { generateObjectService } from '../../../../scripts/modules/ai-services-unified.js';
import {
	getDefaultNumTasks,
	getDebugFlag,
	getMainProvider,
	getResearchProvider,
	getDefaultPriority
} from '../../../../scripts/modules/config-manager.js';
import { getPromptManager } from '../../../../scripts/modules/prompt-manager.js';
import { CUSTOM_PROVIDERS } from '../../../../src/constants/providers.js';
import { createLogWrapper } from '../../tools/utils.js';

// Define the Zod schema for a SINGLE task object
const prdSingleTaskSchema = z.object({
	id: z.number(),
	title: z.string().min(1),
	description: z.string().min(1),
	details: z.string(),
	testStrategy: z.string(),
	priority: z.enum(['high', 'medium', 'low']),
	dependencies: z.array(z.number()),
	status: z.string()
});

// Define the Zod schema for the ENTIRE expected AI response object
const prdResponseSchema = z.object({
	tasks: z.array(prdSingleTaskSchema),
	metadata: z.object({
		projectName: z.string(),
		totalTasks: z.number(),
		sourceFile: z.string(),
		generatedAt: z.string()
	})
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
 * Database-powered PRD parsing function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {string} projectId - Project ID (optional)
 * @param {string} prdPath - Path to the PRD file
 * @param {number} numTasks - Number of tasks to generate
 * @param {Object} options - Additional options
 * @param {boolean} [options.force=false] - Whether to overwrite existing tasks.json.
 * @param {boolean} [options.append=false] - Append to existing tasks file.
 * @param {boolean} [options.research=false] - Use research model for enhanced PRD analysis.
 * @param {Object} [options.mcpLog] - MCP logger object (optional).
 * @param {Object} [options.session] - Session object from MCP server (optional).
 * @param {string} [options.projectRoot] - Project root path (for MCP/env fallback).
 * @param {string} [options.tag] - Target tag for task generation.
 * @param {string} [options.commandName] - Command name for telemetry
 * @param {string} [options.outputType] - Output type for telemetry
 * @returns {Promise<Object>} - Result object with success status and telemetry data
 */
async function parsePRDDb(
	userId,
	projectId = null,
	prdPath,
	numTasks,
	options = {}
) {
	const {
		session,
		projectRoot,
		force = false,
		append = false,
		research = false,
		tag,
		commandName = 'parse-prd',
		outputType = 'mcp',
		mcpLog
	} = options;

	const isMCP = !!mcpLog;

	// Create logger wrapper
	const logFn = isMCP
		? mcpLog
		: {
			info: (msg) => console.log(`[INFO] ${msg}`),
			warn: (msg) => console.warn(`[WARN] ${msg}`),
			error: (msg) => console.error(`[ERROR] ${msg}`),
			debug: (msg) => console.log(`[DEBUG] ${msg}`),
			success: (msg) => console.log(`[SUCCESS] ${msg}`)
		};

	// Create custom reporter using logFn
	const report = (message, level = 'info') => {
		if (logFn && typeof logFn[level] === 'function') {
			logFn[level](message);
		}
	};

	try {
		// Validate user ID
		if (!userId) {
			throw new DatabaseError('User ID is required for PRD parsing');
		}

		// Check if PRD file exists
		if (!fs.existsSync(prdPath)) {
			throw new DatabaseError(`PRD file not found: ${prdPath}`);
		}

		report(`Parsing PRD file: ${prdPath}, Force: ${force}, Append: ${append}, Research: ${research}`);

		// Read PRD content
		const prdContent = fs.readFileSync(prdPath, 'utf8');
		if (!prdContent) {
			throw new DatabaseError(`Input file ${prdPath} is empty or could not be read.`);
		}

		// Get existing tasks for the user and tag
		let existingTasks = [];
		let nextTaskNumber = 1;

		try {
			const allTasks = await db.tasks.list(userId, { projectId });
			existingTasks = allTasks.filter(task => !tag || task.tag === tag);

			if (existingTasks.length > 0) {
				nextTaskNumber = Math.max(...existingTasks.map(t => t.task_number || 0)) + 1;
			}
		} catch (error) {
			logFn.warn(`Error fetching existing tasks: ${error.message}`);
		}

		// Handle existing tasks logic
		if (existingTasks.length > 0) {
			if (append) {
				report(`Append mode enabled. Found ${existingTasks.length} existing tasks${tag ? ` in tag '${tag}'` : ''}. Next task number will be ${nextTaskNumber}.`, 'info');
			} else if (!force) {
				const overwriteError = new Error(
					`${tag ? `Tag '${tag}'` : 'Project'} already contains ${existingTasks.length} tasks. Use force=true to overwrite or append=true to add to existing tasks.`
				);
				report(overwriteError.message, 'error');
				throw overwriteError;
			} else {
				// Force overwrite - delete existing tasks if not appending
				report(`Force flag enabled. Overwriting existing tasks${tag ? ` in tag '${tag}'` : ''}.`, 'info');
			}
		} else {
			report(`${tag ? `Tag '${tag}'` : 'Project'} is empty. Creating new tasks.`, 'info');
		}

		// Load prompts using PromptManager
		const promptManager = getPromptManager();

		// Get defaultTaskPriority from config
		const defaultTaskPriority = getDefaultPriority(projectRoot) || 'medium';

		// Check if Claude Code is being used as the provider
		const currentProvider = research
			? getResearchProvider(projectRoot)
			: getMainProvider(projectRoot);
		const isClaudeCode = currentProvider === CUSTOM_PROVIDERS.CLAUDE_CODE;

		const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
			'parse-prd',
			{
				research,
				numTasks,
				nextId: nextTaskNumber,
				prdContent,
				prdPath,
				defaultTaskPriority,
				isClaudeCode,
				projectRoot: projectRoot || ''
			}
		);

		// Call the unified AI service
		report(
			`Calling AI service to generate tasks from PRD${research ? ' with research-backed analysis' : ''}...`,
			'info'
		);

		// Call generateObjectService with the schema and additional telemetry params
		const aiServiceResponse = await generateObjectService({
			role: research ? 'research' : 'main',
			session: session,
			projectRoot: projectRoot,
			schema: prdResponseSchema,
			objectName: 'tasks_data',
			systemPrompt: systemPrompt,
			prompt: userPrompt,
			commandName: commandName,
			outputType: outputType
		});

		logFn.success(
			`Successfully parsed PRD via AI service${research ? ' with research-backed analysis' : ''}.`
		);

		// Robustly get the actual AI-generated object
		let generatedData = null;
		if (aiServiceResponse?.mainResult) {
			if (
				typeof aiServiceResponse.mainResult === 'object' &&
				aiServiceResponse.mainResult !== null &&
				'tasks' in aiServiceResponse.mainResult
			) {
				generatedData = aiServiceResponse.mainResult;
			} else if (
				typeof aiServiceResponse.mainResult.object === 'object' &&
				aiServiceResponse.mainResult.object !== null &&
				'tasks' in aiServiceResponse.mainResult.object
			) {
				generatedData = aiServiceResponse.mainResult.object;
			}
		}

		if (!generatedData || !Array.isArray(generatedData.tasks)) {
			logFn.error(
				`Internal Error: generateObjectService returned unexpected data structure: ${JSON.stringify(generatedData)}`
			);
			throw new Error(
				'AI service returned unexpected data structure after validation.'
			);
		}

		// Process tasks and create task ID mapping
		let currentTaskNumber = nextTaskNumber;
		const taskMap = new Map();
		const processedNewTasks = generatedData.tasks.map((task) => {
			const newTaskNumber = currentTaskNumber++;
			taskMap.set(task.id, newTaskNumber);
			return {
				...task,
				taskNumber: newTaskNumber,
				status: task.status || 'pending',
				priority: task.priority || 'medium',
				dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
				// Ensure all required fields have values
				title: task.title || '',
				description: task.description || '',
				details: task.details || '',
				testStrategy: task.testStrategy || ''
			};
		});

		// Remap dependencies for the newly processed tasks
		processedNewTasks.forEach((task) => {
			task.dependencies = task.dependencies
				.map((depId) => taskMap.get(depId))
				.filter(
					(newDepId) =>
						newDepId != null &&
						newDepId < task.taskNumber &&
						(existingTasks.some((t) => t.task_number === newDepId) ||
							processedNewTasks.some((t) => t.taskNumber === newDepId))
				);
		});

		// If not appending and force is true, delete existing tasks
		if (!append && force && existingTasks.length > 0) {
			for (const existingTask of existingTasks) {
				try {
					await db.tasks.delete(userId, existingTask.id);
					logFn.info(`Deleted existing task #${existingTask.task_number}`);
				} catch (deleteError) {
					logFn.warn(`Failed to delete existing task #${existingTask.task_number}: ${deleteError.message}`);
				}
			}
		}

		// Create tasks in database
		const createdTasks = [];
		for (const task of processedNewTasks) {
			try {
				const newTask = await db.tasks.create(userId, {
					projectId,
					taskNumber: task.taskNumber,
					title: task.title,
					description: task.description,
					priority: task.priority,
					status: task.status,
					details: {
						implementation: task.details,
						testStrategy: task.testStrategy,
						aiGenerated: true,
						sourceFile: prdPath,
						originalPrompt: `PRD parsing from ${path.basename(prdPath)}`
					}
				});

				createdTasks.push(newTask);
				logFn.info(`Created task #${newTask.task_number} with ID: ${newTask.id}`);

				// Add dependencies if any
				if (task.dependencies && task.dependencies.length > 0) {
					for (const depTaskNumber of task.dependencies) {
						try {
							// Find the dependency task by task number
							const depTask = await db.tasks.getByNumber(userId, depTaskNumber, projectId);
							await db.dependencies.add(userId, newTask.id, depTask.id);
							logFn.info(`Added dependency: task #${newTask.task_number} depends on task #${depTaskNumber}`);
						} catch (depError) {
							logFn.warn(`Failed to add dependency on task #${depTaskNumber}: ${depError.message}`);
						}
					}
				}

				// Handle tag assignment
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
						logFn.info(`Assigned tag "${tag}" to task #${newTask.task_number}`);

					} catch (tagError) {
						logFn.warn(`Failed to assign tag "${tag}": ${tagError.message}`);
					}
				}

				// Log task creation in history
				await db.history.log(userId, {
					taskId: newTask.id,
					action: 'created',
					changeSummary: `Task #${newTask.task_number} created from PRD parsing`,
					newValue: {
						title: newTask.title,
						description: newTask.description,
						priority: newTask.priority,
						method: 'ai_prd_parsing'
					}
				});

			} catch (taskError) {
				logFn.error(`Failed to create task "${task.title}": ${taskError.message}`);
			}
		}

		const successMessage = `Successfully ${append ? 'appended' : 'generated'} ${createdTasks.length} tasks from PRD${research ? ' with research-backed analysis' : ''}`;

		report(successMessage, 'success');

		// Prepare telemetry data
		const telemetryData = {
			success: true,
			tasksGenerated: createdTasks.length,
			tasksAppended: append ? existingTasks.length : 0,
			totalTasks: createdTasks.length + (append ? existingTasks.length : 0),
			researchMode: research,
			forceMode: force,
			appendMode: append,
			tag: tag || null,
			commandName: commandName,
			outputType: outputType,
			sourceFile: prdPath,
			timestamp: new Date().toISOString(),
			aiGenerationSuccess: true,
			...(aiServiceResponse?.telemetryData || {})
		};

		return {
			success: true,
			message: successMessage,
			tasksGenerated: createdTasks.length,
			telemetryData,
			tagInfo: tag ? { name: tag, action: 'assigned' } : null
		};

	} catch (error) {
		report(`Error parsing PRD: ${error.message}`, 'error');

		if (getDebugFlag(projectRoot)) {
			console.error(error);
		}

		// Prepare error telemetry
		const errorTelemetry = {
			success: false,
			error: error.message,
			timestamp: new Date().toISOString(),
			commandName: commandName,
			outputType: outputType
		};

		throw new DatabaseError(`Failed to parse PRD: ${error.message}`, error.code, {
			telemetryData: errorTelemetry
		});
	}
}

/**
 * Direct function wrapper for parsing PRD documents with database operations
 *
 * This is the main entry point that replaces the file-based parsePRDDirect function
 */
export async function parsePRDDirect(args, log, context = {}) {
	const {
		input: inputArg,
		output: outputArg,
		numTasks: numTasksArg,
		force,
		append,
		research,
		projectRoot,
		tag
	} = args;

	const { session } = context;

	// Create logger wrapper
	const mcpLog = createLogWrapper(log);

	try {
		// Extract user ID from context (will be from JWT in Phase 2)
		const userId = getUserId(context);

		// Resolve input path
		let inputPath;
		if (inputArg) {
			// For now, use the path as provided - in Phase 2 this might need resolution
			inputPath = inputArg;
		} else {
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'Input path is required'
				}
			};
		}

		// Parse numTasks
		let numTasks = getDefaultNumTasks(projectRoot);
		if (numTasksArg) {
			numTasks = typeof numTasksArg === 'string' ? parseInt(numTasksArg, 10) : numTasksArg;
			if (Number.isNaN(numTasks) || numTasks < 0) {
				numTasks = getDefaultNumTasks(projectRoot);
				mcpLog.warn(`Invalid numTasks value: ${numTasksArg}. Using default: ${numTasks}`);
			}
		}

		// Call the database-powered PRD parsing
		const result = await parsePRDDb(
			userId,
			null, // projectId - will be added in Phase 2
			inputPath,
			numTasks,
			{
				session,
				mcpLog,
				projectRoot,
				force: force || false,
				append: append || false,
				research: research || false,
				tag,
				commandName: 'parse-prd',
				outputType: 'mcp'
			}
		);

		return {
			success: true,
			data: {
				message: result.message,
				outputPath: inputPath, // For compatibility, return the input path
				telemetryData: result.telemetryData,
				tagInfo: result.tagInfo
			}
		};

	} catch (error) {
		log.error(`Error in parsePRDDirect: ${error.message}`);

		return {
			success: false,
			error: {
				code: error.code || 'PARSE_PRD_ERROR',
				message: error.message
			}
		};
	}
}