
import readline from 'readline';
import fs from 'fs';

import { log, readJSON, writeJSON, isSilentMode } from '../utils.js';

import { generateTextService } from '../ai-services-unified.js';

import {
	getDebugFlag,
	getProjectName,
	getMainProvider,
	getResearchProvider
} from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
import {
	COMPLEXITY_REPORT_FILE,
	LEGACY_TASKS_FILE
} from '../../../src/constants/paths.js';
import { CUSTOM_PROVIDERS } from '../../../src/constants/providers.js';
import { resolveComplexityReportOutputPath } from '../../../src/utils/path-utils.js';
import { ContextGatherer } from '../utils/contextGatherer.js';
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';
import { flattenTasksWithSubtasks } from '../utils.js';

/**
 * Generates the prompt for complexity analysis.
 * (Moved from ai-services.js and simplified)
 * @param {Object} tasksData - The tasks data object.
 * @param {string} [gatheredContext] - The gathered context for the analysis.
 * @returns {string} The generated prompt.
 */
function generateInternalComplexityAnalysisPrompt(
	tasksData,
	gatheredContext = ''
) {
	const tasksString = JSON.stringify(tasksData.tasks, null, 2);
	let prompt = `Analyze the following tasks to determine their complexity (1-10 scale) and recommend the number of subtasks for expansion. Provide a brief reasoning and an initial expansion prompt for each.

Tasks:
${tasksString}`;

	if (gatheredContext) {
		prompt += `\n\n# Project Context\n\n${gatheredContext}`;
	}

	prompt += `

Respond ONLY with a valid JSON array matching the schema:
[
  {
    "taskId": <number>,
    "taskTitle": "<string>",
    "complexityScore": <number 1-10>,
    "recommendedSubtasks": <number>,
    "expansionPrompt": "<string>",
    "reasoning": "<string>"
  },
  ...
]

Do not include any explanatory text, markdown formatting, or code block markers before or after the JSON array.`;
	return prompt;
}

/**
 * Analyzes task complexity and generates expansion recommendations
 * @param {Object} options Command options
 * @param {string} options.file - Path to tasks file
 * @param {string} options.output - Path to report output file
 * @param {string|number} [options.threshold] - Complexity threshold
 * @param {boolean} [options.research] - Use research role
 * @param {string} [options.projectRoot] - Project root path (for MCP/env fallback).
 * @param {string} [options.tag] - Tag for the task
 * @param {string} [options.id] - Comma-separated list of task IDs to analyze specifically
 * @param {number} [options.from] - Starting task ID in a range to analyze
 * @param {number} [options.to] - Ending task ID in a range to analyze
 * @param {Object} [options._filteredTasksData] - Pre-filtered task data (internal use)
 * @param {number} [options._originalTaskCount] - Original task count (internal use)
 * @param {Object} context - Context object, potentially containing session and mcpLog
 * @param {Object} [context.session] - Session object from MCP server (optional)
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {function} [context.reportProgress] - Deprecated: Function to report progress (ignored)
 */
async function analyzeTaskComplexity(options, context = {}) {
	const { session, mcpLog } = context;
	const tasksPath = options.file || LEGACY_TASKS_FILE;
	const thresholdScore = parseFloat(options.threshold || '5');
	const useResearch = options.research || false;
	const projectRoot = options.projectRoot;
	const tag = options.tag;
	// New parameters for task ID filtering
	const specificIds = options.id
		? options.id
				.split(',')
				.map((id) => parseInt(id.trim(), 10))
				.filter((id) => !Number.isNaN(id))
		: null;
	const fromId = options.from !== undefined ? parseInt(options.from, 10) : null;
	const toId = options.to !== undefined ? parseInt(options.to, 10) : null;

	const outputFormat = mcpLog ? 'json' : 'text';

	const reportLog = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			log(level, message);
		}
	};

	// Resolve output path using tag-aware resolution
	const outputPath = resolveComplexityReportOutputPath(
		options.output,
		{ projectRoot, tag },
		reportLog
	);

	if (outputFormat === 'text') {
		console.log(
			(
				'Analyzing task complexity and generating expansion recommendations...'
			)
		);
	}

	try {
		reportLog(`Reading tasks from ${tasksPath}...`, 'info');
		let tasksData;
		let originalTaskCount = 0;
		let originalData = null;

		if (options._filteredTasksData) {
			tasksData = options._filteredTasksData;
			originalTaskCount = options._originalTaskCount || tasksData.tasks.length;
			if (!options._originalTaskCount) {
				try {
					originalData = readJSON(tasksPath, projectRoot, tag);
					if (originalData && originalData.tasks) {
						originalTaskCount = originalData.tasks.length;
					}
				} catch (e) {
					log('warn', `Could not read original tasks file: ${e.message}`);
				}
			}
		} else {
			originalData = readJSON(tasksPath, projectRoot, tag);
			if (
				!originalData ||
				!originalData.tasks ||
				!Array.isArray(originalData.tasks) ||
				originalData.tasks.length === 0
			) {
				throw new Error('No tasks found in the tasks file');
			}
			originalTaskCount = originalData.tasks.length;

			// Filter tasks based on active status
			const activeStatuses = ['pending', 'blocked', 'in-progress'];
			let filteredTasks = originalData.tasks.filter((task) =>
				activeStatuses.includes(task.status?.toLowerCase() || 'pending')
			);

			// Apply ID filtering if specified
			if (specificIds && specificIds.length > 0) {
				reportLog(
					`Filtering tasks by specific IDs: ${specificIds.join(', ')}`,
					'info'
				);
				filteredTasks = filteredTasks.filter((task) =>
					specificIds.includes(task.id)
				);

				if (outputFormat === 'text') {
					if (filteredTasks.length === 0 && specificIds.length > 0) {
						console.log(
							(
								`Warning: No active tasks found with IDs: ${specificIds.join(', ')}`
							)
						);
					} else if (filteredTasks.length < specificIds.length) {
						const foundIds = filteredTasks.map((t) => t.id);
						const missingIds = specificIds.filter(
							(id) => !foundIds.includes(id)
						);
						console.log(
							(
								`Warning: Some requested task IDs were not found or are not active: ${missingIds.join(', ')}`
							)
						);
					}
				}
			}
			// Apply range filtering if specified
			else if (fromId !== null || toId !== null) {
				const effectiveFromId = fromId !== null ? fromId : 1;
				const effectiveToId =
					toId !== null
						? toId
						: Math.max(...originalData.tasks.map((t) => t.id));

				reportLog(
					`Filtering tasks by ID range: ${effectiveFromId} to ${effectiveToId}`,
					'info'
				);
				filteredTasks = filteredTasks.filter(
					(task) => task.id >= effectiveFromId && task.id <= effectiveToId
				);

				if (outputFormat === 'text' && filteredTasks.length === 0) {
					console.log(
						(
							`Warning: No active tasks found in range: ${effectiveFromId}-${effectiveToId}`
						)
					);
				}
			}

			tasksData = {
				...originalData,
				tasks: filteredTasks,
				_originalTaskCount: originalTaskCount
			};
		}

		// --- Context Gathering ---
		let gatheredContext = '';
		if (originalData && originalData.tasks.length > 0) {
			try {
				const contextGatherer = new ContextGatherer(projectRoot, tag);
				const allTasksFlat = flattenTasksWithSubtasks(originalData.tasks);
				const fuzzySearch = new FuzzyTaskSearch(
					allTasksFlat,
					'analyze-complexity'
				);
				// Create a query from the tasks being analyzed
				const searchQuery = tasksData.tasks
					.map((t) => `${t.title} ${t.description}`)
					.join(' ');
				const searchResults = fuzzySearch.findRelevantTasks(searchQuery, {
					maxResults: 10
				});
				const relevantTaskIds = fuzzySearch.getTaskIds(searchResults);

				if (relevantTaskIds.length > 0) {
					const contextResult = await contextGatherer.gather({
						tasks: relevantTaskIds,
						format: 'research'
					});
					gatheredContext = contextResult.context || '';
				}
			} catch (contextError) {
				reportLog(
					`Could not gather additional context: ${contextError.message}`,
					'warn'
				);
			}
		}
		// --- End Context Gathering ---

		const skippedCount = originalTaskCount - tasksData.tasks.length;
		reportLog(
			`Found ${originalTaskCount} total tasks in the task file.`,
			'info'
		);

		// Updated messaging to reflect filtering logic
		if (specificIds || fromId !== null || toId !== null) {
			const filterMsg = specificIds
				? `Analyzing ${tasksData.tasks.length} tasks with specific IDs: ${specificIds.join(', ')}`
				: `Analyzing ${tasksData.tasks.length} tasks in range: ${fromId || 1} to ${toId || 'end'}`;

			reportLog(filterMsg, 'info');
			if (outputFormat === 'text') {
				console.log((filterMsg));
			}
		} else if (skippedCount > 0) {
			const skipMessage = `Skipping ${skippedCount} tasks marked as done/cancelled/deferred. Analyzing ${tasksData.tasks.length} active tasks.`;
			reportLog(skipMessage, 'info');
			if (outputFormat === 'text') {
				console.log((skipMessage));
			}
		}

		// Check for existing report before doing analysis
		let existingReport = null;
		const existingAnalysisMap = new Map(); // For quick lookups by task ID
		try {
			if (fs.existsSync(outputPath)) {
				existingReport = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
				reportLog(`Found existing complexity report at ${outputPath}`, 'info');

				if (
					existingReport &&
					existingReport.complexityAnalysis &&
					Array.isArray(existingReport.complexityAnalysis)
				) {
					// Create lookup map of existing analysis entries
					existingReport.complexityAnalysis.forEach((item) => {
						existingAnalysisMap.set(item.taskId, item);
					});
					reportLog(
						`Existing report contains ${existingReport.complexityAnalysis.length} task analyses`,
						'info'
					);
				}
			}
		} catch (readError) {
			reportLog(
				`Warning: Could not read existing report: ${readError.message}`,
				'warn'
			);
			existingReport = null;
			existingAnalysisMap.clear();
		}

		if (tasksData.tasks.length === 0) {
			// If using ID filtering but no matching tasks, return existing report or empty
			if (existingReport && (specificIds || fromId !== null || toId !== null)) {
				reportLog(
					'No matching tasks found for analysis. Keeping existing report.',
					'info'
				);
				if (outputFormat === 'text') {
					console.log(
						(
							'No matching tasks found for analysis. Keeping existing report.'
						)
					);
				}
				return {
					report: existingReport,
					telemetryData: null
				};
			}

			// Otherwise create empty report
			const emptyReport = {
				meta: {
					generatedAt: new Date().toISOString(),
					tasksAnalyzed: 0,
					thresholdScore: thresholdScore,
					projectName: getProjectName(session),
					usedResearch: useResearch
				},
				complexityAnalysis: existingReport?.complexityAnalysis || []
			};
			reportLog(`Writing complexity report to ${outputPath}...`, 'info');
			fs.writeFileSync(
				outputPath,
				JSON.stringify(emptyReport, null, '\t'),
				'utf8'
			);
			reportLog(
				`Task complexity analysis complete. Report written to ${outputPath}`,
				'success'
			);
			if (outputFormat === 'text') {
				console.log(
					(
						`Task complexity analysis complete. Report written to ${outputPath}`
					)
				);
				const highComplexity = 0;
				const mediumComplexity = 0;
				const lowComplexity = 0;
				const totalAnalyzed = 0;

				console.log('\nComplexity Analysis Summary:');
				console.log('----------------------------');
				console.log(`Tasks in input file: ${originalTaskCount}`);
				console.log(`Tasks successfully analyzed: ${totalAnalyzed}`);
				console.log(`High complexity tasks: ${highComplexity}`);
				console.log(`Medium complexity tasks: ${mediumComplexity}`);
				console.log(`Low complexity tasks: ${lowComplexity}`);
				console.log(
					`Sum verification: ${highComplexity + mediumComplexity + lowComplexity} (should equal ${totalAnalyzed})`
				);
				console.log(`Research-backed analysis: ${useResearch ? 'Yes' : 'No'}`);
				console.log(
					`\nSee ${outputPath} for the full report and expansion commands.`
				);

				console.log(
					
						('Suggested Next Steps:' +
							'\n\n' +
							`${('1.')} Run ${('task-master complexity-report')} to review detailed findings\n` +
							`${('2.')} Run ${('task-master expand --id=<id>')} to break down complex tasks\n` +
							`${('3.')} Run ${('task-master expand --all')} to expand all pending tasks based on complexity`,
						{
							padding: 1,
							borderColor: 'cyan',
							borderStyle: 'round',
							margin: { top: 1 }
						}
					)
				);
			}
			return {
				report: emptyReport,
				telemetryData: null
			};
		}

		// Continue with regular analysis path
		// Load prompts using PromptManager
		const promptManager = getPromptManager();

		// Check if Claude Code is being used as the provider
		const currentProvider = useResearch
			? getResearchProvider(projectRoot)
			: getMainProvider(projectRoot);
		const isClaudeCode = currentProvider === CUSTOM_PROVIDERS.CLAUDE_CODE;

		const promptParams = {
			tasks: tasksData.tasks,
			gatheredContext: gatheredContext || '',
			useResearch: useResearch,
			isClaudeCode: isClaudeCode,
			projectRoot: projectRoot || ''
		};

		const { systemPrompt, userPrompt: prompt } = await promptManager.loadPrompt(
			'analyze-complexity',
			promptParams,
			'default'
		);

		let loadingIndicator = null;
		if (outputFormat === 'text') {
			loadingIndicator = startLoadingIndicator(
				`${useResearch ? 'Researching' : 'Analyzing'} the complexity of your tasks with AI...\n`
			);
		}

		let aiServiceResponse = null;
		let complexityAnalysis = null;

		try {
			const role = useResearch ? 'research' : 'main';

			aiServiceResponse = await generateTextService({
				prompt,
				systemPrompt,
				role,
				session,
				projectRoot,
				commandName: 'analyze-complexity',
				outputType: mcpLog ? 'mcp' : 'cli'
			});

			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
			if (outputFormat === 'text') {
				readline.clearLine(process.stdout, 0);
				readline.cursorTo(process.stdout, 0);
				console.log(
					('AI service call complete. Parsing response...')
				);
			}

			reportLog('Parsing complexity analysis from text response...', 'info');
			try {
				let cleanedResponse = aiServiceResponse.mainResult;
				cleanedResponse = cleanedResponse.trim();

				const codeBlockMatch = cleanedResponse.match(
					/```(?:json)?\s*([\s\S]*?)\s*```/
				);
				if (codeBlockMatch) {
					cleanedResponse = codeBlockMatch[1].trim();
				} else {
					const firstBracket = cleanedResponse.indexOf('[');
					const lastBracket = cleanedResponse.lastIndexOf(']');
					if (firstBracket !== -1 && lastBracket > firstBracket) {
						cleanedResponse = cleanedResponse.substring(
							firstBracket,
							lastBracket + 1
						);
					} else {
						reportLog(
							'Warning: Response does not appear to be a JSON array.',
							'warn'
						);
					}
				}

				if (outputFormat === 'text' && getDebugFlag(session)) {
					console.log(('Attempting to parse cleaned JSON...'));
					console.log(('Cleaned response (first 100 chars):'));
					console.log((cleanedResponse.substring(0, 100)));
					console.log(('Last 100 chars:'));
					console.log(
						(cleanedResponse.substring(cleanedResponse.length - 100))
					);
				}

				complexityAnalysis = JSON.parse(cleanedResponse);
			} catch (parseError) {
				if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
				reportLog(
					`Error parsing complexity analysis JSON: ${parseError.message}`,
					'error'
				);
				if (outputFormat === 'text') {
					console.error(
						(
							`Error parsing complexity analysis JSON: ${parseError.message}`
						)
					);
				}
				throw parseError;
			}

			const taskIds = tasksData.tasks.map((t) => t.id);
			const analysisTaskIds = complexityAnalysis.map((a) => a.taskId);
			const missingTaskIds = taskIds.filter(
				(id) => !analysisTaskIds.includes(id)
			);

			if (missingTaskIds.length > 0) {
				reportLog(
					`Missing analysis for ${missingTaskIds.length} tasks: ${missingTaskIds.join(', ')}`,
					'warn'
				);
				if (outputFormat === 'text') {
					console.log(
						(
							`Missing analysis for ${missingTaskIds.length} tasks: ${missingTaskIds.join(', ')}`
						)
					);
				}
				for (const missingId of missingTaskIds) {
					const missingTask = tasksData.tasks.find((t) => t.id === missingId);
					if (missingTask) {
						reportLog(`Adding default analysis for task ${missingId}`, 'info');
						complexityAnalysis.push({
							taskId: missingId,
							taskTitle: missingTask.title,
							complexityScore: 5,
							recommendedSubtasks: 3,
							expansionPrompt: `Break down this task with a focus on ${missingTask.title.toLowerCase()}.`,
							reasoning:
								'Automatically added due to missing analysis in AI response.'
						});
					}
				}
			}

			// Merge with existing report - only keep entries from the current tag
			let finalComplexityAnalysis = [];

			if (existingReport && Array.isArray(existingReport.complexityAnalysis)) {
				// Create a map of task IDs that we just analyzed
				const analyzedTaskIds = new Set(
					complexityAnalysis.map((item) => item.taskId)
				);

				// Keep existing entries that weren't in this analysis run AND belong to the current tag
				// We determine tag membership by checking if the task ID exists in the current tag's tasks
				const currentTagTaskIds = new Set(tasksData.tasks.map((t) => t.id));
				const existingEntriesNotAnalyzed =
					existingReport.complexityAnalysis.filter(
						(item) =>
							!analyzedTaskIds.has(item.taskId) &&
							currentTagTaskIds.has(item.taskId) // Only keep entries for tasks in current tag
					);

				// Combine with new analysis
				finalComplexityAnalysis = [
					...existingEntriesNotAnalyzed,
					...complexityAnalysis
				];

				reportLog(
					`Merged ${complexityAnalysis.length} new analyses with ${existingEntriesNotAnalyzed.length} existing entries from current tag`,
					'info'
				);
			} else {
				// No existing report or invalid format, just use the new analysis
				finalComplexityAnalysis = complexityAnalysis;
			}

			const report = {
				meta: {
					generatedAt: new Date().toISOString(),
					tasksAnalyzed: tasksData.tasks.length,
					totalTasks: originalTaskCount,
					analysisCount: finalComplexityAnalysis.length,
					thresholdScore: thresholdScore,
					projectName: getProjectName(session),
					usedResearch: useResearch
				},
				complexityAnalysis: finalComplexityAnalysis
			};
			reportLog(`Writing complexity report to ${outputPath}...`, 'info');
			fs.writeFileSync(outputPath, JSON.stringify(report, null, '\t'), 'utf8');

			reportLog(
				`Task complexity analysis complete. Report written to ${outputPath}`,
				'success'
			);

			if (outputFormat === 'text') {
				console.log(
					(
						`Task complexity analysis complete. Report written to ${outputPath}`
					)
				);
				// Calculate statistics specifically for this analysis run
				const highComplexity = complexityAnalysis.filter(
					(t) => t.complexityScore >= 8
				).length;
				const mediumComplexity = complexityAnalysis.filter(
					(t) => t.complexityScore >= 5 && t.complexityScore < 8
				).length;
				const lowComplexity = complexityAnalysis.filter(
					(t) => t.complexityScore < 5
				).length;
				const totalAnalyzed = complexityAnalysis.length;

				console.log('\nCurrent Analysis Summary:');
				console.log('----------------------------');
				console.log(`Tasks analyzed in this run: ${totalAnalyzed}`);
				console.log(`High complexity tasks: ${highComplexity}`);
				console.log(`Medium complexity tasks: ${mediumComplexity}`);
				console.log(`Low complexity tasks: ${lowComplexity}`);

				if (existingReport) {
					console.log('\nUpdated Report Summary:');
					console.log('----------------------------');
					console.log(
						`Total analyses in report: ${finalComplexityAnalysis.length}`
					);
					console.log(
						`Analyses from previous runs: ${finalComplexityAnalysis.length - totalAnalyzed}`
					);
					console.log(`New/updated analyses: ${totalAnalyzed}`);
				}

				console.log(`Research-backed analysis: ${useResearch ? 'Yes' : 'No'}`);
				console.log(
					`\nSee ${outputPath} for the full report and expansion commands.`
				);

				console.log(
					
						('Suggested Next Steps:' +
							'\n\n' +
							`${('1.')} Run ${('task-master complexity-report')} to review detailed findings\n` +
							`${('2.')} Run ${('task-master expand --id=<id>')} to break down complex tasks\n` +
							`${('3.')} Run ${('task-master expand --all')} to expand all pending tasks based on complexity`,
						{
							padding: 1,
							borderColor: 'cyan',
							borderStyle: 'round',
							margin: { top: 1 }
						}
					)
				);

				if (getDebugFlag(session)) {
					console.debug(
						(
							`Final analysis object: ${JSON.stringify(report, null, 2)}`
						)
					);
				}

			}

			return {
				report: report,
				telemetryData: aiServiceResponse?.telemetryData,
				tagInfo: aiServiceResponse?.tagInfo
			};
		} catch (aiError) {
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
			reportLog(`Error during AI service call: ${aiError.message}`, 'error');
			if (outputFormat === 'text') {
				console.error(
					(`Error during AI service call: ${aiError.message}`)
				);
				if (aiError.message.includes('API key')) {
					console.log(
						(
							'\nPlease ensure your API keys are correctly configured in .env or ~/.taskmaster/.env'
						)
					);
					console.log(
						("Run 'task-master models --setup' if needed.")
					);
				}
			}
			throw aiError;
		}
	} catch (error) {
		reportLog(`Error analyzing task complexity: ${error.message}`, 'error');
		if (outputFormat === 'text') {
			console.error(
				(`Error analyzing task complexity: ${error.message}`)
			);
			if (getDebugFlag(session)) {
				console.error(error);
			}
			process.exit(1);
		} else {
			throw error;
		}
	}
}

export default analyzeTaskComplexity;
