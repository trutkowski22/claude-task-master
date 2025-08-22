// Core initialization logic extracted from CLI
import {
	enableSilentMode,
	disableSilentMode
	// isSilentMode // Not used directly here
} from '../../../../scripts/modules/utils.js';
import os from 'os'; // Import os module for home directory check
import { RULE_PROFILES } from '../../../../src/constants/profiles.js';
import { convertAllRulesToProfileRules } from '../../../../src/utils/rule-transformer.js';
import fs from 'fs';
import path from 'path';

/**
 * Core project initialization function (extracted from CLI)
 * @param {Object} options - Initialization options
 * @returns {Promise<Object>} - Result object with success status
 */
async function initializeProject(options = {}) {
	try {
		const {
			addAliases = false,
			initGit = false,
			storeTasksInGit = false,
			skipInstall = false,
			yes = false,
			rules = ['cursor']
		} = options;

		const projectRoot = process.cwd();
		
		// Create .taskmaster directory structure
		const taskmasterDir = path.join(projectRoot, '.taskmaster');
		const tasksDir = path.join(taskmasterDir, 'tasks');
		const docsDir = path.join(taskmasterDir, 'docs');
		const templatesDir = path.join(taskmasterDir, 'templates');
		
		// Create directories if they don't exist
		[taskmasterDir, tasksDir, docsDir, templatesDir].forEach(dir => {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		});

		// Create initial config.json if it doesn't exist
		const configPath = path.join(taskmasterDir, 'config.json');
		if (!fs.existsSync(configPath)) {
			const config = {
				global: {
					defaultTag: 'master',
					logLevel: 'info',
					debug: false
				},
				ai: {
					provider: 'anthropic',
					model: 'claude-3-5-sonnet-20241022'
				}
			};
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		}

		// Create initial state.json if it doesn't exist
		const statePath = path.join(taskmasterDir, 'state.json');
		if (!fs.existsSync(statePath)) {
			const state = {
				currentTag: 'master',
				lastSwitched: new Date().toISOString(),
				branchTagMapping: {},
				migrationNoticeShown: false
			};
			fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
		}

		// Create initial tasks.json if it doesn't exist
		const tasksPath = path.join(tasksDir, 'tasks.json');
		if (!fs.existsSync(tasksPath)) {
			const initialTasks = {
				master: {
					tasks: [],
					metadata: {
						created: new Date().toISOString(),
						updated: new Date().toISOString(),
						description: 'Tasks for master context'
					}
				}
			};
			fs.writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2));
		}

		// Handle rules setup if provided
		if (rules && rules.length > 0) {
			try {
				await convertAllRulesToProfileRules(projectRoot, rules);
			} catch (ruleError) {
				// Rules setup is optional - don't fail initialization
				console.warn(`Warning: Could not set up rules: ${ruleError.message}`);
			}
		}

		return {
			success: true,
			message: 'Project initialized successfully',
			projectRoot,
			createdDirectories: [taskmasterDir, tasksDir, docsDir, templatesDir],
			createdFiles: [configPath, statePath, tasksPath].filter(file => 
				fs.existsSync(file) && fs.statSync(file).birthtime > new Date(Date.now() - 5000)
			)
		};

	} catch (error) {
		return {
			success: false,
			error: { 
				code: 'INITIALIZATION_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Direct function wrapper for initializing a project.
 * Derives target directory from session, sets CWD, and calls core init logic.
 * @param {object} args - Arguments containing initialization options (addAliases, initGit, storeTasksInGit, skipInstall, yes, projectRoot, rules)
 * @param {object} log - The FastMCP logger instance.
 * @param {object} context - The context object, must contain { session }.
 * @returns {Promise<{success: boolean, data?: any, error?: {code: string, message: string}}>} - Standard result object.
 */
export async function initializeProjectDirect(args, log, context = {}) {
	const { session } = context; // Keep session if core logic needs it
	const homeDir = os.homedir();

	log.info(`Args received in direct function: ${JSON.stringify(args)}`);

	// --- Determine Target Directory ---
	// TRUST the projectRoot passed from the tool layer via args
	// The HOF in the tool layer already normalized and validated it came from a reliable source (args or session)
	const targetDirectory = args.projectRoot;

	// --- Validate the targetDirectory (basic sanity checks) ---
	if (
		!targetDirectory ||
		typeof targetDirectory !== 'string' || // Ensure it's a string
		targetDirectory === '/' ||
		targetDirectory === homeDir
	) {
		log.error(
			`Invalid target directory received from tool layer: '${targetDirectory}'`
		);
		return {
			success: false,
			error: {
				code: 'INVALID_TARGET_DIRECTORY',
				message: `Cannot initialize project: Invalid target directory '${targetDirectory}' received. Please ensure a valid workspace/folder is open or specified.`,
				details: `Received args.projectRoot: ${args.projectRoot}` // Show what was received
			}
		};
	}

	// --- Proceed with validated targetDirectory ---
	log.info(`Validated target directory for initialization: ${targetDirectory}`);

	const originalCwd = process.cwd();
	let resultData;
	let success = false;
	let errorResult = null;

	log.info(
		`Temporarily changing CWD to ${targetDirectory} for initialization.`
	);
	process.chdir(targetDirectory); // Change CWD to the HOF-provided root

	enableSilentMode();
	try {
		// Construct options ONLY from the relevant flags in args
		// The core initializeProject operates in the current CWD, which we just set
		const options = {
			addAliases: args.addAliases,
			initGit: args.initGit,
			storeTasksInGit: args.storeTasksInGit,
			skipInstall: args.skipInstall,
			yes: true // Force yes mode
		};

		// Handle rules option with MCP-specific defaults
		if (Array.isArray(args.rules) && args.rules.length > 0) {
			options.rules = args.rules;
			options.rulesExplicitlyProvided = true;
			log.info(`Including rules: ${args.rules.join(', ')}`);
		} else {
			// For MCP initialization, default to Cursor profile only
			options.rules = ['cursor'];
			options.rulesExplicitlyProvided = true;
			log.info(`No rule profiles specified, defaulting to: Cursor`);
		}

		log.info(`Initializing project with options: ${JSON.stringify(options)}`);
		const result = await initializeProject(options); // Call core logic

		resultData = {
			message: 'Project initialized successfully.',
			next_step:
				'Now that the project is initialized, the next step is to create the tasks by parsing a PRD. This will create the tasks folder and the initial task files (tasks folder will be created when parse-prd is run). The parse-prd tool will require a prd.txt file as input (typically found in .taskmaster/docs/ directory). You can create a prd.txt file by asking the user about their idea, and then using the .taskmaster/templates/example_prd.txt file as a template to generate a prd.txt file in .taskmaster/docs/. You may skip all of this if the user already has a prd.txt file. You can THEN use the parse-prd tool to create the tasks. So: step 1 after initialization is to create a prd.txt file in .taskmaster/docs/prd.txt or confirm the user already has one. Step 2 is to use the parse-prd tool to create the tasks. Do not bother looking for tasks after initialization, just use the parse-prd tool to create the tasks after creating a prd.txt from which to parse the tasks. You do NOT need to reinitialize the project to parse-prd.',
			...result
		};
		success = true;
		log.info(
			`Project initialization completed successfully in ${targetDirectory}.`
		);
	} catch (error) {
		log.error(`Core initializeProject failed: ${error.message}`);
		errorResult = {
			code: 'INITIALIZATION_FAILED',
			message: `Core project initialization failed: ${error.message}`,
			details: error.stack
		};
		success = false;
	} finally {
		disableSilentMode();
		log.info(`Restoring original CWD: ${originalCwd}`);
		process.chdir(originalCwd);
	}

	if (success) {
		return { success: true, data: resultData };
	} else {
		return { success: false, error: errorResult };
	}
}
