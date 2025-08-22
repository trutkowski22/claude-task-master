import fs from 'fs';
import path from 'path';

import {
	log as consoleLog,
	readJSON,
	writeJSON,
	truncate,
	isSilentMode,
	findProjectRoot,
	flattenTasksWithSubtasks
} from '../utils.js';
import { generateTextService } from '../ai-services-unified.js';
import { getDebugFlag } from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
import generateTaskFiles from './generate-task-files.js';
import { ContextGatherer } from '../utils/contextGatherer.js';
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';

/**
 * Update a subtask by appending additional timestamped information using the unified AI service.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} subtaskId - ID of the subtask to update in format "parentId.subtaskId"
 * @param {string} prompt - Prompt for generating additional information
 * @param {boolean} [useResearch=false] - Whether to use the research AI role.
 * @param {Object} context - Context object containing session and mcpLog.
 * @param {Object} [context.session] - Session object from MCP server.
 * @param {Object} [context.mcpLog] - MCP logger object.
 * @param {string} [context.projectRoot] - Project root path (needed for AI service key resolution).
 * @param {string} [context.tag] - Tag for the task
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json'). Automatically 'json' if mcpLog is present.
 * @returns {Promise<Object|null>} - The updated subtask or null if update failed.
 */
async function updateSubtaskById(
	tasksPath,
	subtaskId,
	prompt,
	useResearch = false,
	context = {},
	outputFormat = context.mcpLog ? 'json' : 'text'
) {
	const { session, mcpLog, projectRoot: providedProjectRoot, tag } = context;
	const logFn = mcpLog || consoleLog;
	const isMCP = !!mcpLog;

	// Report helper
	const report = (level, ...args) => {
		if (isMCP) {
			if (typeof logFn[level] === 'function') logFn[level](...args);
			else logFn.info(...args);
		} else if (!isSilentMode()) {
			logFn(level, ...args);
		}
	};

	try {
		report('info', `Updating subtask ${subtaskId} with prompt: "${prompt}"`);

		if (
			!subtaskId ||
			typeof subtaskId !== 'string' ||
			!subtaskId.includes('.')
		) {
			throw new Error(
				`Invalid subtask ID format: ${subtaskId}. Subtask ID must be in format "parentId.subtaskId"`
			);
		}

		if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
			throw new Error(
				'Prompt cannot be empty. Please provide context for the subtask update.'
			);
		}

		if (!fs.existsSync(tasksPath)) {
			throw new Error(`Tasks file not found at path: ${tasksPath}`);
		}

		const projectRoot = providedProjectRoot || findProjectRoot();
		if (!projectRoot) {
			throw new Error('Could not determine project root directory');
		}

		const data = readJSON(tasksPath, projectRoot, tag);
		if (!data || !data.tasks) {
			throw new Error(
				`No valid tasks found in ${tasksPath}. The file may be corrupted or have an invalid format.`
			);
		}

		const [parentIdStr, subtaskIdStr] = subtaskId.split('.');
		const parentId = parseInt(parentIdStr, 10);
		const subtaskIdNum = parseInt(subtaskIdStr, 10);

		if (
			Number.isNaN(parentId) ||
			parentId <= 0 ||
			Number.isNaN(subtaskIdNum) ||
			subtaskIdNum <= 0
		) {
			throw new Error(
				`Invalid subtask ID format: ${subtaskId}. Both parent ID and subtask ID must be positive integers.`
			);
		}

		const parentTask = data.tasks.find((task) => task.id === parentId);
		if (!parentTask) {
			throw new Error(
				`Parent task with ID ${parentId} not found. Please verify the task ID and try again.`
			);
		}

		if (!parentTask.subtasks || !Array.isArray(parentTask.subtasks)) {
			throw new Error(`Parent task ${parentId} has no subtasks.`);
		}

		const subtaskIndex = parentTask.subtasks.findIndex(
			(st) => st.id === subtaskIdNum
		);
		if (subtaskIndex === -1) {
			throw new Error(
				`Subtask with ID ${subtaskId} not found. Please verify the subtask ID and try again.`
			);
		}

		const subtask = parentTask.subtasks[subtaskIndex];

		// --- Context Gathering ---
		let gatheredContext = '';
		try {
			const contextGatherer = new ContextGatherer(projectRoot, tag);
			const allTasksFlat = flattenTasksWithSubtasks(data.tasks);
			const fuzzySearch = new FuzzyTaskSearch(allTasksFlat, 'update-subtask');
			const searchQuery = `${parentTask.title} ${subtask.title} ${prompt}`;
			const searchResults = fuzzySearch.findRelevantTasks(searchQuery, {
				maxResults: 5,
				includeSelf: true
			});
			const relevantTaskIds = fuzzySearch.getTaskIds(searchResults);

			const finalTaskIds = [
				...new Set([subtaskId.toString(), ...relevantTaskIds])
			];

			if (finalTaskIds.length > 0) {
				const contextResult = await contextGatherer.gather({
					tasks: finalTaskIds,
					format: 'research'
				});
				gatheredContext = contextResult.context || '';
			}
		} catch (contextError) {
			report('warn', `Could not gather context: ${contextError.message}`);
		}
		// --- End Context Gathering ---

		let generatedContentString = '';
		let newlyAddedSnippet = '';
		let aiServiceResponse = null;

		try {
			const parentContext = {
				id: parentTask.id,
				title: parentTask.title
			};
			const prevSubtask =
				subtaskIndex > 0
					? {
							id: `${parentTask.id}.${parentTask.subtasks[subtaskIndex - 1].id}`,
							title: parentTask.subtasks[subtaskIndex - 1].title,
							status: parentTask.subtasks[subtaskIndex - 1].status
						}
					: undefined;
			const nextSubtask =
				subtaskIndex < parentTask.subtasks.length - 1
					? {
							id: `${parentTask.id}.${parentTask.subtasks[subtaskIndex + 1].id}`,
							title: parentTask.subtasks[subtaskIndex + 1].title,
							status: parentTask.subtasks[subtaskIndex + 1].status
						}
					: undefined;

			// Build prompts using PromptManager
			const promptManager = getPromptManager();

			const promptParams = {
				parentTask: parentContext,
				prevSubtask: prevSubtask,
				nextSubtask: nextSubtask,
				currentDetails: subtask.details || '(No existing details)',
				updatePrompt: prompt,
				useResearch: useResearch,
				gatheredContext: gatheredContext || ''
			};

			const variantKey = useResearch ? 'research' : 'default';
			const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
				'update-subtask',
				promptParams,
				variantKey
			);

			const role = useResearch ? 'research' : 'main';
			report('info', `Using AI text service with role: ${role}`);

			aiServiceResponse = await generateTextService({
				prompt: userPrompt,
				systemPrompt: systemPrompt,
				role,
				session,
				projectRoot,
				maxRetries: 2,
				commandName: 'update-subtask',
				outputType: isMCP ? 'mcp' : 'cli'
			});

			if (
				aiServiceResponse &&
				aiServiceResponse.mainResult &&
				typeof aiServiceResponse.mainResult === 'string'
			) {
				generatedContentString = aiServiceResponse.mainResult;
			} else {
				generatedContentString = '';
				report(
					'warn',
					'AI service response did not contain expected text string.'
				);
			}
		} catch (aiError) {
			report('error', `AI service call failed: ${aiError.message}`);
			throw aiError;
		}

		if (generatedContentString && generatedContentString.trim()) {
			// Check if the string is not empty
			const timestamp = new Date().toISOString();
			const formattedBlock = `<info added on ${timestamp}>\n${generatedContentString.trim()}\n</info added on ${timestamp}>`;
			newlyAddedSnippet = formattedBlock; // <--- ADD THIS LINE: Store for display

			subtask.details =
				(subtask.details ? subtask.details + '\n' : '') + formattedBlock;
		} else {
			report(
				'warn',
				'AI response was empty or whitespace after trimming. Original details remain unchanged.'
			);
			newlyAddedSnippet = 'No new details were added by the AI.';
		}

		const updatedSubtask = parentTask.subtasks[subtaskIndex];

		if (updatedSubtask.description) {
			if (prompt.length < 100) {
				updatedSubtask.description += ` [Updated: ${new Date().toLocaleDateString()}]`;
			}
		}

		writeJSON(tasksPath, data, projectRoot, tag);

		report('success', `Successfully updated subtask ${subtaskId}`);

		return {
			updatedSubtask: updatedSubtask,
			newlyAddedSnippet: newlyAddedSnippet,
			telemetryData: aiServiceResponse.telemetryData,
			tagInfo: aiServiceResponse.tagInfo
		};
	} catch (error) {
		report('error', `Error updating subtask: ${error.message}`);
		if (outputFormat === 'text') {
			throw error;
		} else {
			throw error;
		}
	}
}

export default updateSubtaskById;