/**
 * research-db.js
 * Database-powered implementation for AI-powered research queries
 *
 * This replaces the file-based research.js with database operations
 */

import path from 'path';
import { performResearch } from '../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';
import { db, DatabaseError } from '../../database/index.js';
import { getDebugFlag } from '../../../scripts/modules/config-manager.js';

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
 * Database-powered research function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} args - Research arguments
 * @param {Object} log - Logger object
 * @param {Object} context - Additional context (session)
 * @returns {Promise<Object>} - Result object with success status and data
 */
async function researchDb(userId, args, log, context = {}) {
	const {
		query,
		taskIds,
		filePaths,
		customContext,
		includeProjectTree = false,
		detailLevel = 'medium',
		saveTo,
		saveToFile = false,
		projectRoot,
		tag
	} = args;
	const { session } = context;

	// Enable silent mode to prevent console logs from interfering with JSON response
	enableSilentMode();

	// Create logger wrapper using the utility
	const mcpLog = createLogWrapper(log);

	try {
		// Validate user ID
		if (!userId) {
			throw new DatabaseError('User ID is required for research operations');
		}

		// Check required parameters
		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			log.error('Missing or invalid required parameter: query');
			disableSilentMode();
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message:
						'The query parameter is required and must be a non-empty string'
				}
			};
		}

		// Parse comma-separated task IDs if provided
		const parsedTaskIds = taskIds
			? taskIds
					.split(',')
					.map((id) => id.trim())
					.filter((id) => id.length > 0)
			: [];

		// Parse comma-separated file paths if provided
		const parsedFilePaths = filePaths
			? filePaths
					.split(',')
					.map((path) => path.trim())
					.filter((path) => path.length > 0)
			: [];

		// Validate detail level
		const validDetailLevels = ['low', 'medium', 'high'];
		if (!validDetailLevels.includes(detailLevel)) {
			log.error(`Invalid detail level: ${detailLevel}`);
			disableSilentMode();
			return {
				success: false,
				error: {
					code: 'INVALID_PARAMETER',
					message: `Detail level must be one of: ${validDetailLevels.join(', ')}`
				}
			};
		}

		log.info(
			`Performing database-powered research query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}", ` +
				`taskIds: [${parsedTaskIds.join(', ')}], ` +
				`filePaths: [${parsedFilePaths.join(', ')}], ` +
				`detailLevel: ${detailLevel}, ` +
				`includeProjectTree: ${includeProjectTree}, ` +
				`projectRoot: ${projectRoot}`
		);

		// Prepare options for the research function
		const researchOptions = {
			taskIds: parsedTaskIds,
			filePaths: parsedFilePaths,
			customContext: customContext || '',
			includeProjectTree,
			detailLevel,
			projectRoot,
			tag,
			saveToFile
		};

		// Prepare context for the research function
		const researchContext = {
			session,
			mcpLog,
			commandName: 'research',
			outputType: 'mcp'
		};

		// Call the performResearch function
		const result = await performResearch(
			query.trim(),
			researchOptions,
			researchContext,
			'json', // outputFormat - use 'json' to suppress CLI UI
			false // allowFollowUp - disable for MCP calls
		);

		// Auto-save to task/subtask if requested
		if (saveTo) {
			try {
				const isSubtask = saveTo.includes('.');

				// Format research content for saving
				const researchContent = `## Research Query: ${query.trim()}

**Detail Level:** ${result.detailLevel}
**Context Size:** ${result.contextSize} characters
**Timestamp:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}

### Results

${result.result}`;

				if (isSubtask) {
					// Save to subtask using database operations
					const [parentTaskNumber, subtaskId] = saveTo.split('.').map(id => parseInt(id, 10));

					// Find the subtask by parent task number and subtask ID
					const parentTask = await db.tasks.getByNumber(userId, parentTaskNumber, null, tag);
					if (!parentTask) {
						throw new Error(`Parent task ${parentTaskNumber} not found`);
					}

					const subtasks = await db.subtasks.listByTask(userId, parentTask.id);
					const subtask = subtasks.find(st => st.subtask_number === subtaskId);

					if (!subtask) {
						throw new Error(`Subtask ${saveTo} not found`);
					}

					// Update subtask with research content
					await db.subtasks.update(userId, subtask.id, {
						details: {
							...subtask.details,
							research: researchContent
						}
					});

					// Log the update in history
					await db.history.log(userId, {
						taskId: parentTask.id,
						subtaskId: subtask.id,
						action: 'updated',
						changeSummary: `Research saved to subtask ${saveTo}`,
						newValue: { researchContent }
					});

					log.info(`Research saved to subtask ${saveTo} (database)`);
				} else {
					// Save to task using database operations
					const taskNumber = parseInt(saveTo, 10);
					const task = await db.tasks.getByNumber(userId, taskNumber, null, tag);

					if (!task) {
						throw new Error(`Task ${saveTo} not found`);
					}

					// Update task with research content
					await db.tasks.update(userId, task.id, {
						details: {
							...task.details,
							research: researchContent
						}
					});

					// Log the update in history
					await db.history.log(userId, {
						taskId: task.id,
						action: 'updated',
						changeSummary: `Research saved to task ${saveTo}`,
						newValue: { researchContent }
					});

					log.info(`Research saved to task ${saveTo} (database)`);
				}
			} catch (saveError) {
				log.warn(`Error saving research to task/subtask: ${saveError.message}`);
			}
		}

		// Restore normal logging
		disableSilentMode();

		return {
			success: true,
			data: {
				query: result.query,
				result: result.result,
				contextSize: result.contextSize,
				contextTokens: result.contextTokens,
				tokenBreakdown: result.tokenBreakdown,
				systemPromptTokens: result.systemPromptTokens,
				userPromptTokens: result.userPromptTokens,
				totalInputTokens: result.totalInputTokens,
				detailLevel: result.detailLevel,
				telemetryData: result.telemetryData,
				tagInfo: result.tagInfo,
				savedFilePath: result.savedFilePath
			}
		};
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in researchDb: ${error.message}`);

		if (getDebugFlag && getDebugFlag(projectRoot)) {
			console.error(error);
		}

		// Prepare error telemetry
		const errorTelemetry = {
			success: false,
			error: error.message,
			timestamp: new Date().toISOString(),
			commandName: 'research',
			outputType: 'mcp'
		};

		throw new DatabaseError(`Failed to perform research: ${error.message}`, error.code, {
			telemetryData: errorTelemetry
		});
	}
}

/**
 * Direct function wrapper for performing AI-powered research with database operations
 *
 * This is the main entry point that replaces the file-based researchDirect function
 */
export async function researchDirect(args, log, context = {}) {
	const {
		query,
		taskIds,
		filePaths,
		customContext,
		includeProjectTree = false,
		detailLevel = 'medium',
		saveTo,
		saveToFile = false,
		projectRoot,
		tag
	} = args;

	const { session } = context;

	// Create logger wrapper
	const mcpLog = createLogWrapper(log);

	try {
		// Extract user ID from context (will be from JWT in Phase 2)
		const userId = getUserId(context);

		// Prepare research arguments
		const researchArgs = {
			query,
			taskIds,
			filePaths,
			customContext,
			includeProjectTree,
			detailLevel,
			saveTo,
			saveToFile,
			projectRoot,
			tag
		};

		// Call the database-powered research function
		const result = await researchDb(
			userId,
			researchArgs,
			log,
			{ session }
		);

		return result;

	} catch (error) {
		log.error(`Error in researchDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: error.code || 'RESEARCH_ERROR',
				message: error.message
			}
		};
	}
}