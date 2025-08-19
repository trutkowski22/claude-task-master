import path from 'path';
import { z } from 'zod';
import Fuse from 'fuse.js'; // Import Fuse.js for advanced fuzzy search

import {
	readJSON,
	writeJSON,
	log as consoleLog,
	truncate,
	ensureTagMetadata,
	performCompleteTagMigration,
	markMigrationForNotice
} from '../utils.js';
import { generateObjectService } from '../ai-services-unified.js';
import { getDefaultPriority } from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
import ContextGatherer from '../utils/contextGatherer.js';
import generateTaskFiles from './generate-task-files.js';
import {
	TASK_PRIORITY_OPTIONS,
	DEFAULT_TASK_PRIORITY,
	isValidTaskPriority,
	normalizeTaskPriority
} from '../../../src/constants/task-priority.js';

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
 * Get all tasks from all tags
 * @param {Object} rawData - The raw tagged data object
 * @returns {Array} A flat array of all task objects
 */
function getAllTasks(rawData) {
	let allTasks = [];
	for (const tagName in rawData) {
		if (
			Object.prototype.hasOwnProperty.call(rawData, tagName) &&
			rawData[tagName] &&
			Array.isArray(rawData[tagName].tasks)
		) {
			allTasks = allTasks.concat(rawData[tagName].tasks);
		}
	}
	return allTasks;
}

/**
 * Add a new task using AI
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} prompt - Description of the task to add (required for AI-driven creation)
 * @param {Array} dependencies - Task dependencies
 * @param {string} priority - Task priority
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @param {Object} customEnv - Custom environment variables (optional) - Note: AI params override deprecated
 * @param {Object} manualTaskData - Manual task data (optional, for direct task creation without AI)
 * @param {boolean} useResearch - Whether to use the research model (passed to unified service)
 * @param {Object} context - Context object containing session and potentially projectRoot
 * @param {string} [context.projectRoot] - Project root path (for MCP/env fallback)
 * @param {string} [context.commandName] - The name of the command being executed (for telemetry)
 * @param {string} [context.outputType] - The output type ('cli' or 'mcp', for telemetry)
 * @param {string} [context.tag] - Tag for the task (optional)
 * @returns {Promise<object>} An object containing newTaskId and telemetryData
 */
async function addTask(
	tasksPath,
	prompt,
	dependencies = [],
	priority = null,
	context = {},
	outputFormat = 'text', // Default to text for CLI
	manualTaskData = null,
	useResearch = false
) {
	const { session, mcpLog, projectRoot, commandName, outputType, tag } =
		context;
	const isMCP = !!mcpLog;

	// Create a consistent logFn object regardless of context
	const logFn = isMCP
		? mcpLog // Use MCP logger if provided
		: {
				// Create a wrapper around consoleLog for CLI
				info: (...args) => consoleLog('info', ...args),
				warn: (...args) => consoleLog('warn', ...args),
				error: (...args) => consoleLog('error', ...args),
				debug: (...args) => consoleLog('debug', ...args),
				success: (...args) => consoleLog('success', ...args)
			};

	// Validate priority - only accept high, medium, or low
	let effectivePriority =
		priority || getDefaultPriority(projectRoot) || DEFAULT_TASK_PRIORITY;

	// If priority is provided, validate and normalize it
	if (priority) {
		const normalizedPriority = normalizeTaskPriority(priority);
		if (normalizedPriority) {
			effectivePriority = normalizedPriority;
		} else {
			effectivePriority = DEFAULT_TASK_PRIORITY;
		}
	}

	logFn.info(
		`Adding new task with prompt: "${prompt}", Priority: ${effectivePriority}, Dependencies: ${dependencies.join(', ') || 'None'}, Research: ${useResearch}, ProjectRoot: ${projectRoot}`
	);
	if (tag) {
		logFn.info(`Using tag context: ${tag}`);
	}

	let aiServiceResponse = null; // To store the full response from AI service

	// Create custom reporter that checks for MCP log
	const report = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (outputFormat === 'text') {
			consoleLog(level, message);
		}
	};

	/**
	 * Recursively builds a dependency graph for a given task
	 * @param {Array} tasks - All tasks from tasks.json
	 * @param {number} taskId - ID of the task to analyze
	 * @param {Set} visited - Set of already visited task IDs
	 * @param {Map} depthMap - Map of task ID to its depth in the graph
	 * @param {number} depth - Current depth in the recursion
	 * @return {Object} Dependency graph data
	 */
	function buildDependencyGraph(
		tasks,
		taskId,
		visited = new Set(),
		depthMap = new Map(),
		depth = 0
	) {
		// Skip if we've already visited this task or it doesn't exist
		if (visited.has(taskId)) {
			return null;
		}

		// Find the task
		const task = tasks.find((t) => t.id === taskId);
		if (!task) {
			return null;
		}

		// Mark as visited
		visited.add(taskId);

		// Update depth if this is a deeper path to this task
		if (!depthMap.has(taskId) || depth < depthMap.get(taskId)) {
			depthMap.set(taskId, depth);
		}

		// Process dependencies
		const dependencyData = [];
		if (task.dependencies && task.dependencies.length > 0) {
			for (const depId of task.dependencies) {
				const depData = buildDependencyGraph(
					tasks,
					depId,
					visited,
					depthMap,
					depth + 1
				);
				if (depData) {
					dependencyData.push(depData);
				}
			}
		}

		return {
			id: task.id,
			title: task.title,
			description: task.description,
			status: task.status,
			dependencies: dependencyData
		};
	}

	try {
		// Read the existing tasks - IMPORTANT: Read the raw data without tag resolution
		let rawData = readJSON(tasksPath, projectRoot, tag); // No tag parameter

		// Handle the case where readJSON returns resolved data with _rawTaggedData
		if (rawData && rawData._rawTaggedData) {
			// Use the raw tagged data and discard the resolved view
			rawData = rawData._rawTaggedData;
		}

		// If file doesn't exist or is invalid, create a new structure in memory
		if (!rawData) {
			report(
				'tasks.json not found or invalid. Initializing new structure.',
				'info'
			);
			rawData = {
				master: {
					tasks: [],
					metadata: {
						created: new Date().toISOString(),
						description: 'Default tasks context'
					}
				}
			};
			// Do not write the file here; it will be written later with the new task.
		}

		// Handle legacy format migration using utilities
		if (rawData && Array.isArray(rawData.tasks) && !rawData._rawTaggedData) {
			report('Legacy format detected. Migrating to tagged format...', 'info');

			// This is legacy format - migrate it to tagged format
			rawData = {
				master: {
					tasks: rawData.tasks,
					metadata: rawData.metadata || {
						created: new Date().toISOString(),
						updated: new Date().toISOString(),
						description: 'Tasks for master context'
					}
				}
			};
			// Ensure proper metadata using utility
			ensureTagMetadata(rawData.master, {
				description: 'Tasks for master context'
			});
			// Do not write the file here; it will be written later with the new task.

			// Perform complete migration (config.json, state.json)
			performCompleteTagMigration(tasksPath);
			markMigrationForNotice(tasksPath);

			report('Successfully migrated to tagged format.', 'success');
		}

		// Use the provided tag, or the current active tag, or default to 'master'
		const targetTag = tag;

		// Ensure the target tag exists
		if (!rawData[targetTag]) {
			report(
				`Tag "${targetTag}" does not exist. Please create it first using the 'add-tag' command.`,
				'error'
			);
			throw new Error(`Tag "${targetTag}" not found.`);
		}

		// Ensure the target tag has a tasks array and metadata object
		if (!rawData[targetTag].tasks) {
			rawData[targetTag].tasks = [];
		}
		if (!rawData[targetTag].metadata) {
			rawData[targetTag].metadata = {
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				description: ``
			};
		}

		// Get a flat list of ALL tasks across ALL tags to validate dependencies
		const allTasks = getAllTasks(rawData);

		// Find the highest task ID *within the target tag* to determine the next ID
		const tasksInTargetTag = rawData[targetTag].tasks;
		const highestId =
			tasksInTargetTag.length > 0
				? Math.max(...tasksInTargetTag.map((t) => t.id))
				: 0;
		const newTaskId = highestId + 1;

		// Validate dependencies before proceeding
		const invalidDeps = dependencies.filter((depId) => {
			// Ensure depId is parsed as a number for comparison
			const numDepId = parseInt(depId, 10);
			return Number.isNaN(numDepId) || !allTasks.some((t) => t.id === numDepId);
		});

		if (invalidDeps.length > 0) {
			report(
				`The following dependencies do not exist or are invalid: ${invalidDeps.join(', ')}`,
				'warn'
			);
			report('Removing invalid dependencies...', 'info');
			dependencies = dependencies.filter(
				(depId) => !invalidDeps.includes(depId)
			);
		}
		// Ensure dependencies are numbers
		const numericDependencies = dependencies.map((dep) => parseInt(dep, 10));

		// Build dependency graphs for explicitly specified dependencies
		const dependencyGraphs = [];
		const allRelatedTaskIds = new Set();
		const depthMap = new Map();

		// First pass: build a complete dependency graph for each specified dependency
		for (const depId of numericDependencies) {
			const graph = buildDependencyGraph(allTasks, depId, new Set(), depthMap);
			if (graph) {
				dependencyGraphs.push(graph);
			}
		}

		// Second pass: build a set of all related task IDs for flat analysis
		for (const [taskId, depth] of depthMap.entries()) {
			allRelatedTaskIds.add(taskId);
		}

		let taskData;

		// Check if manual task data is provided
		if (manualTaskData) {
			report('Using manually provided task data', 'info');
			taskData = manualTaskData;
			report('DEBUG: Taking MANUAL task data path.', 'debug');

			// Basic validation for manual data
			if (
				!taskData.title ||
				typeof taskData.title !== 'string' ||
				!taskData.description ||
				typeof taskData.description !== 'string'
			) {
				throw new Error(
					'Manual task data must include at least a title and description.'
				);
			}
		} else {
			report('DEBUG: Taking AI task generation path.', 'debug');
			// --- Refactored AI Interaction ---
			report(`Generating task data with AI with prompt:\n${prompt}`, 'info');

			// --- Use the new ContextGatherer ---
			const contextGatherer = new ContextGatherer(projectRoot, tag);
			const gatherResult = await contextGatherer.gather({
				semanticQuery: prompt,
				dependencyTasks: numericDependencies,
				format: 'research'
			});

			const gatheredContext = gatherResult.context;
			const analysisData = gatherResult.analysisData;

			// Add any manually provided details to the prompt for context
			let contextFromArgs = '';
			if (manualTaskData?.title)
				contextFromArgs += `\n- Suggested Title: "${manualTaskData.title}"`;
			if (manualTaskData?.description)
				contextFromArgs += `\n- Suggested Description: "${manualTaskData.description}"`;
			if (manualTaskData?.details)
				contextFromArgs += `\n- Additional Details Context: "${manualTaskData.details}"`;
			if (manualTaskData?.testStrategy)
				contextFromArgs += `\n- Additional Test Strategy Context: "${manualTaskData.testStrategy}"`;

			// Load prompts using PromptManager
			const promptManager = getPromptManager();
			const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
				'add-task',
				{
					prompt,
					newTaskId,
					existingTasks: allTasks,
					gatheredContext,
					contextFromArgs,
					useResearch,
					priority: effectivePriority,
					dependencies: numericDependencies
				}
			);

			try {
				const serviceRole = useResearch ? 'research' : 'main';
				report('DEBUG: Calling generateObjectService...', 'debug');

				aiServiceResponse = await generateObjectService({
					// Capture the full response
					role: serviceRole,
					session: session,
					projectRoot: projectRoot,
					schema: AiTaskDataSchema,
					objectName: 'newTaskData',
					systemPrompt: systemPrompt,
					prompt: userPrompt,
					commandName: commandName || 'add-task', // Use passed commandName or default
					outputType: outputType || (isMCP ? 'mcp' : 'cli') // Use passed outputType or derive
				});
				report('DEBUG: generateObjectService returned successfully.', 'debug');

				if (!aiServiceResponse || !aiServiceResponse.mainResult) {
					throw new Error(
						'AI service did not return the expected object structure.'
					);
				}

				// Prefer mainResult if it looks like a valid task object, otherwise try mainResult.object
				if (
					aiServiceResponse.mainResult.title &&
					aiServiceResponse.mainResult.description
				) {
					taskData = aiServiceResponse.mainResult;
				} else if (
					aiServiceResponse.mainResult.object &&
					aiServiceResponse.mainResult.object.title &&
					aiServiceResponse.mainResult.object.description
				) {
					taskData = aiServiceResponse.mainResult.object;
				} else {
					throw new Error('AI service did not return a valid task object.');
				}

				report('Successfully generated task data from AI.', 'success');
			} catch (error) {
				report(
					`DEBUG: generateObjectService caught error: ${error.message}`,
					'debug'
				);
				report(`Error generating task with AI: ${error.message}`, 'error');
				throw error; // Re-throw error after logging
			} finally {
				report('DEBUG: generateObjectService finally block reached.', 'debug');
			}
			// --- End Refactored AI Interaction ---
		}

		// Create the new task object
		const newTask = {
			id: newTaskId,
			title: taskData.title,
			description: taskData.description,
			details: taskData.details || '',
			testStrategy: taskData.testStrategy || '',
			status: 'pending',
			dependencies: taskData.dependencies?.length
				? taskData.dependencies
				: numericDependencies, // Use AI-suggested dependencies if available, fallback to manually specified
			priority: effectivePriority,
			subtasks: [] // Initialize with empty subtasks array
		};

		// Additional check: validate all dependencies in the AI response
		if (taskData.dependencies?.length) {
			const allValidDeps = taskData.dependencies.every((depId) => {
				const numDepId = parseInt(depId, 10);
				return (
					!Number.isNaN(numDepId) && allTasks.some((t) => t.id === numDepId)
				);
			});

			if (!allValidDeps) {
				report(
					'AI suggested invalid dependencies. Filtering them out...',
					'warn'
				);
				newTask.dependencies = taskData.dependencies.filter((depId) => {
					const numDepId = parseInt(depId, 10);
					return (
						!Number.isNaN(numDepId) && allTasks.some((t) => t.id === numDepId)
					);
				});
			}
		}

		// Add the task to the tasks array OF THE CORRECT TAG
		rawData[targetTag].tasks.push(newTask);
		// Update the tag's metadata
		ensureTagMetadata(rawData[targetTag], {
			description: `Tasks for ${targetTag} context`
		});

		report('DEBUG: Writing tasks.json...', 'debug');
		// Write the updated raw data back to the file
		// The writeJSON function will automatically filter out _rawTaggedData
		writeJSON(tasksPath, rawData, projectRoot, targetTag);
		report('DEBUG: tasks.json written.', 'debug');

		report(
			`DEBUG: Returning new task ID: ${newTaskId} and telemetry.`,
			'debug'
		);
		return {
			newTaskId: newTaskId,
			newTask: newTask,
			telemetryData: aiServiceResponse ? aiServiceResponse.telemetryData : null,
			tagInfo: aiServiceResponse ? aiServiceResponse.tagInfo : null
		};
	} catch (error) {
		report(`Error adding task: ${error.message}`, 'error');
		// In MCP mode, we let the direct function handler catch and format
		throw error;
	}
}

export default addTask;