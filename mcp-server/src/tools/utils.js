/**
 * tools/utils.js
 * Utility functions for Task Master CLI integration
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { contextManager } from '../core/context-manager.js'; // Import the singleton
import { fileURLToPath } from 'url';
// Remove CLI dependency - extract minimal needed function
function getCurrentTag(projectRoot) {
	if (!projectRoot) {
		return 'master';
	}

	try {
		// Try to read current tag from state.json
		const statePath = path.join(projectRoot, '.taskmaster', 'state.json');
		if (fs.existsSync(statePath)) {
			const rawState = fs.readFileSync(statePath, 'utf8');
			const stateData = JSON.parse(rawState);
			if (stateData && stateData.currentTag) {
				return stateData.currentTag;
			}
		}
	} catch (error) {
		// Ignore errors, fall back to default
	}

	return 'master';
}

// Import path utilities to ensure consistent path resolution
import {
	lastFoundProjectRoot,
	PROJECT_MARKERS
} from '../core/utils/path-utils.js';

const __filename = fileURLToPath(import.meta.url);

// Cache for version info to avoid repeated file reads
let cachedVersionInfo = null;

/**
 * Get version information from package.json
 * @returns {Object} Version information
 */
function getVersionInfo() {
	// Return cached version if available
	if (cachedVersionInfo) {
		return cachedVersionInfo;
	}

	try {
		// Navigate to the project root from the tools directory
		const packageJsonPath = path.join(
			path.dirname(__filename),
			'../../../package.json'
		);
		if (fs.existsSync(packageJsonPath)) {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			cachedVersionInfo = {
				version: packageJson.version,
				name: packageJson.name
			};
			return cachedVersionInfo;
		}
		cachedVersionInfo = {
			version: 'unknown',
			name: 'task-master-ai'
		};
		return cachedVersionInfo;
	} catch (error) {
		// Fallback version info if package.json can't be read
		cachedVersionInfo = {
			version: 'unknown',
			name: 'task-master-ai'
		};
		return cachedVersionInfo;
	}
}

/**
 * Get current tag information for MCP responses
 * @param {string} projectRoot - The project root directory
 * @param {Object} log - Logger object
 * @returns {Object} Tag information object
 */
function getTagInfo(projectRoot, log) {
	try {
		if (!projectRoot) {
			log.warn('No project root provided for tag information');
			return { currentTag: 'master', availableTags: ['master'] };
		}

		const currentTag = getCurrentTag(projectRoot);

		// Read available tags from tasks.json
		let availableTags = ['master']; // Default fallback
		try {
			const tasksJsonPath = path.join(
				projectRoot,
				'.taskmaster',
				'tasks',
				'tasks.json'
			);
			if (fs.existsSync(tasksJsonPath)) {
				const tasksData = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf-8'));

				// If it's the new tagged format, extract tag keys
				if (
					tasksData &&
					typeof tasksData === 'object' &&
					!Array.isArray(tasksData.tasks)
				) {
					const tagKeys = Object.keys(tasksData).filter(
						(key) =>
							tasksData[key] &&
							typeof tasksData[key] === 'object' &&
							Array.isArray(tasksData[key].tasks)
					);
					if (tagKeys.length > 0) {
						availableTags = tagKeys;
					}
				}
			}
		} catch (tagError) {
			log.debug(`Could not read available tags: ${tagError.message}`);
		}

		return {
			currentTag: currentTag || 'master',
			availableTags: availableTags
		};
	} catch (error) {
		log.warn(`Error getting tag information: ${error.message}`);
		return { currentTag: 'master', availableTags: ['master'] };
	}
}

/**
 * Get normalized project root path
 * @param {string|undefined} projectRootRaw - Raw project root from arguments
 * @param {Object} log - Logger object
 * @returns {string} - Normalized absolute path to project root
 */
function getProjectRoot(projectRootRaw, log) {
	// PRECEDENCE ORDER:
	// 1. Environment variable override (TASK_MASTER_PROJECT_ROOT)
	// 2. Explicitly provided projectRoot in args
	// 3. Previously found/cached project root
	// 4. Current directory if it has project markers
	// 5. Current directory with warning

	// 1. Check for environment variable override
	if (process.env.TASK_MASTER_PROJECT_ROOT) {
		const envRoot = process.env.TASK_MASTER_PROJECT_ROOT;
		const absolutePath = path.isAbsolute(envRoot)
			? envRoot
			: path.resolve(process.cwd(), envRoot);
		log.info(
			`Using project root from TASK_MASTER_PROJECT_ROOT environment variable: ${absolutePath}`
		);
		return absolutePath;
	}

	// 2. If project root is explicitly provided, use it
	if (projectRootRaw) {
		const absolutePath = path.isAbsolute(projectRootRaw)
			? projectRootRaw
			: path.resolve(process.cwd(), projectRootRaw);

		log.info(`Using explicitly provided project root: ${absolutePath}`);
		return absolutePath;
	}

	// 3. If we have a last found project root from a tasks.json search, use that for consistency
	if (lastFoundProjectRoot) {
		log.info(
			`Using last known project root where tasks.json was found: ${lastFoundProjectRoot}`
		);
		return lastFoundProjectRoot;
	}

	// 4. Check if the current directory has any indicators of being a task-master project
	const currentDir = process.cwd();
	if (
		PROJECT_MARKERS.some((marker) => {
			const markerPath = path.join(currentDir, marker);
			return fs.existsSync(markerPath);
		})
	) {
		log.info(
			`Using current directory as project root (found project markers): ${currentDir}`
		);
		return currentDir;
	}

	// 5. Default to current working directory but warn the user
	log.warn(
		`No task-master project detected in current directory. Using ${currentDir} as project root.`
	);
	log.warn(
		'Consider using --project-root to specify the correct project location or set TASK_MASTER_PROJECT_ROOT environment variable.'
	);
	return currentDir;
}

/**
 * Extracts and normalizes the project root path from the MCP session object.
 * @param {Object} session - The MCP session object.
 * @param {Object} log - The MCP logger object.
 * @returns {string|null} - The normalized absolute project root path or null if not found/invalid.
 */
function getProjectRootFromSession(session, log) {
	try {
		// Add detailed logging of session structure
		log.info(
			`Session object: ${JSON.stringify({
				hasSession: !!session,
				hasRoots: !!session?.roots,
				rootsType: typeof session?.roots,
				isRootsArray: Array.isArray(session?.roots),
				rootsLength: session?.roots?.length,
				firstRoot: session?.roots?.[0],
				hasRootsRoots: !!session?.roots?.roots,
				rootsRootsType: typeof session?.roots?.roots,
				isRootsRootsArray: Array.isArray(session?.roots?.roots),
				rootsRootsLength: session?.roots?.roots?.length,
				firstRootsRoot: session?.roots?.roots?.[0]
			})}`
		);

		let rawRootPath = null;
		let decodedPath = null;
		let finalPath = null;

		// Check primary location
		if (session?.roots?.[0]?.uri) {
			rawRootPath = session.roots[0].uri;
			log.info(`Found raw root URI in session.roots[0].uri: ${rawRootPath}`);
		}
		// Check alternate location
		else if (session?.roots?.roots?.[0]?.uri) {
			rawRootPath = session.roots.roots[0].uri;
			log.info(
				`Found raw root URI in session.roots.roots[0].uri: ${rawRootPath}`
			);
		}

		if (rawRootPath) {
			// Decode URI and strip file:// protocol
			decodedPath = rawRootPath.startsWith('file://')
				? decodeURIComponent(rawRootPath.slice(7))
				: rawRootPath; // Assume non-file URI is already decoded? Or decode anyway? Let's decode.
			if (!rawRootPath.startsWith('file://')) {
				decodedPath = decodeURIComponent(rawRootPath); // Decode even if no file://
			}

			// Handle potential Windows drive prefix after stripping protocol (e.g., /C:/...)
			if (
				decodedPath.startsWith('/') &&
				/[A-Za-z]:/.test(decodedPath.substring(1, 3))
			) {
				decodedPath = decodedPath.substring(1); // Remove leading slash if it's like /C:/...
			}

			log.info(`Decoded path: ${decodedPath}`);

			// Normalize slashes and resolve
			const normalizedSlashes = decodedPath.replace(/\\/g, '/');
			finalPath = path.resolve(normalizedSlashes); // Resolve to absolute path for current OS

			log.info(`Normalized and resolved session path: ${finalPath}`);
			return finalPath;
		}

		// Fallback Logic (remains the same)
		log.warn('No project root URI found in session. Attempting fallbacks...');
		const cwd = process.cwd();

		// Fallback 1: Use server path deduction (Cursor IDE)
		const serverPath = process.argv[1];
		if (serverPath && serverPath.includes('mcp-server')) {
			const mcpServerIndex = serverPath.indexOf('mcp-server');
			if (mcpServerIndex !== -1) {
				const projectRoot = path.dirname(
					serverPath.substring(0, mcpServerIndex)
				); // Go up one level

				if (
					fs.existsSync(path.join(projectRoot, '.cursor')) ||
					fs.existsSync(path.join(projectRoot, 'mcp-server')) ||
					fs.existsSync(path.join(projectRoot, 'package.json'))
				) {
					log.info(
						`Using project root derived from server path: ${projectRoot}`
					);
					return projectRoot; // Already absolute
				}
			}
		}

		// Fallback 2: Use CWD
		log.info(`Using current working directory as ultimate fallback: ${cwd}`);
		return cwd; // Already absolute
	} catch (e) {
		log.error(`Error in getProjectRootFromSession: ${e.message}`);
		// Attempt final fallback to CWD on error
		const cwd = process.cwd();
		log.warn(
			`Returning CWD (${cwd}) due to error during session root processing.`
		);
		return cwd;
	}
}

/**
 * Handle API result with standardized error handling and response formatting
 * @param {Object} result - Result object from API call with success, data, and error properties
 * @param {Object} log - Logger object
 * @param {string} errorPrefix - Prefix for error messages
 * @param {Function} processFunction - Optional function to process successful result data
 * @param {string} [projectRoot] - Optional project root for tag information
 * @returns {Object} - Standardized MCP response object
 */
async function handleApiResult(
	result,
	log,
	errorPrefix = 'API error',
	processFunction = processMCPResponseData,
	projectRoot = null
) {
	// Get version info for every response
	const versionInfo = getVersionInfo();

	// Get tag info if project root is provided
	const tagInfo = projectRoot ? getTagInfo(projectRoot, log) : null;

	if (!result.success) {
		const errorMsg = result.error?.message || `Unknown ${errorPrefix}`;
		log.error(`${errorPrefix}: ${errorMsg}`);
		return createErrorResponse(errorMsg, versionInfo, tagInfo);
	}

	// Process the result data if needed
	const processedData = processFunction
		? processFunction(result.data)
		: result.data;

	log.info('Successfully completed operation');

	// Create the response payload including version info and tag info
	const responsePayload = {
		data: processedData,
		version: versionInfo
	};

	// Add tag information if available
	if (tagInfo) {
		responsePayload.tag = tagInfo;
	}

	return createContentResponse(responsePayload);
}

/**
 * Executes a task-master CLI command synchronously.
 * @param {string} command - The command to execute (e.g., 'add-task')
 * @param {Object} log - Logger instance
 * @param {Array} args - Arguments for the command
 * @param {string|undefined} projectRootRaw - Optional raw project root path (will be normalized internally)
 * @param {Object|null} customEnv - Optional object containing environment variables to pass to the child process
 * @returns {Object} - The result of the command execution
 */
function executeTaskMasterCommand(
	command,
	log,
	args = [],
	projectRootRaw = null,
	customEnv = null // Changed from session to customEnv
) {
	try {
		// Normalize project root internally using the getProjectRoot utility
		const cwd = getProjectRoot(projectRootRaw, log);

		log.info(
			`Executing task-master ${command} with args: ${JSON.stringify(
				args
			)} in directory: ${cwd}`
		);

		// Prepare full arguments array
		const fullArgs = [command, ...args];

		// Common options for spawn
		const spawnOptions = {
			encoding: 'utf8',
			cwd: cwd,
			// Merge process.env with customEnv, giving precedence to customEnv
			env: { ...process.env, ...(customEnv || {}) }
		};

		// Log the environment being passed (optional, for debugging)
		// log.info(`Spawn options env: ${JSON.stringify(spawnOptions.env)}`);

		// Execute using the installed task-master-ai package
		let result = spawnSync('npx', ['task-master-ai', ...fullArgs], spawnOptions);

		// If npx fails, try global task-master-ai
		if (result.error && result.error.code === 'ENOENT') {
			log.info('npx not available, trying global task-master-ai');
			result = spawnSync('task-master-ai', fullArgs, spawnOptions);
		}

		if (result.error) {
			throw new Error(`Command execution error: ${result.error.message}`);
		}

		if (result.status !== 0) {
			// Improve error handling by combining stderr and stdout if stderr is empty
			const errorOutput = result.stderr
				? result.stderr.trim()
				: result.stdout
					? result.stdout.trim()
					: 'Unknown error';
			throw new Error(
				`Command failed with exit code ${result.status}: ${errorOutput}`
			);
		}

		return {
			success: true,
			stdout: result.stdout,
			stderr: result.stderr
		};
	} catch (error) {
		log.error(`Error executing task-master command: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Checks cache for a result using the provided key. If not found, executes the action function,
 * caches the result upon success, and returns the result.
 *
 * @param {Object} options - Configuration options.
 * @param {string} options.cacheKey - The unique key for caching this operation's result.
 * @param {Function} options.actionFn - The async function to execute if the cache misses.
 *                                      Should return an object like { success: boolean, data?: any, error?: { code: string, message: string } }.
 * @param {Object} options.log - The logger instance.
 * @returns {Promise<Object>} - An object containing the result.
 *                              Format: { success: boolean, data?: any, error?: { code: string, message: string } }
 */
async function getCachedOrExecute({ cacheKey, actionFn, log }) {
	// Check cache first
	const cachedResult = contextManager.getCachedData(cacheKey);

	if (cachedResult !== undefined) {
		log.info(`Cache hit for key: ${cacheKey}`);
		return cachedResult;
	}

	log.info(`Cache miss for key: ${cacheKey}. Executing action function.`);

	// Execute the action function if cache missed
	const result = await actionFn();

	// If the action was successful, cache the result
	if (result.success && result.data !== undefined) {
		log.info(`Action successful. Caching result for key: ${cacheKey}`);
		contextManager.setCachedData(cacheKey, result);
	} else if (!result.success) {
		log.warn(
			`Action failed for cache key ${cacheKey}. Result not cached. Error: ${result.error?.message}`
		);
	} else {
		log.warn(
			`Action for cache key ${cacheKey} succeeded but returned no data. Result not cached.`
		);
	}

	return result;
}

/**
 * Recursively removes specified fields from task objects, whether single or in an array.
 * Handles common data structures returned by task commands.
 * @param {Object|Array} taskOrData - A single task object or a data object containing a 'tasks' array.
 * @param {string[]} fieldsToRemove - An array of field names to remove.
 * @returns {Object|Array} - The processed data with specified fields removed.
 */
function processMCPResponseData(
	taskOrData,
	fieldsToRemove = ['details', 'testStrategy']
) {
	if (!taskOrData) {
		return taskOrData;
	}

	// Helper function to process a single task object
	const processSingleTask = (task) => {
		if (typeof task !== 'object' || task === null) {
			return task;
		}

		const processedTask = { ...task };

		// Remove specified fields from the task
		fieldsToRemove.forEach((field) => {
			delete processedTask[field];
		});

		// Recursively process subtasks if they exist and are an array
		if (processedTask.subtasks && Array.isArray(processedTask.subtasks)) {
			// Use processArrayOfTasks to handle the subtasks array
			processedTask.subtasks = processArrayOfTasks(processedTask.subtasks);
		}

		return processedTask;
	};

	// Helper function to process an array of tasks
	const processArrayOfTasks = (tasks) => {
		return tasks.map(processSingleTask);
	};

	// Check if the input is a data structure containing a 'tasks' array (like from listTasks)
	if (
		typeof taskOrData === 'object' &&
		taskOrData !== null &&
		Array.isArray(taskOrData.tasks)
	) {
		return {
			...taskOrData, // Keep other potential fields like 'stats', 'filter'
			tasks: processArrayOfTasks(taskOrData.tasks)
		};
	}
	// Check if the input is likely a single task object (add more checks if needed)
	else if (
		typeof taskOrData === 'object' &&
		taskOrData !== null &&
		'id' in taskOrData &&
		'title' in taskOrData
	) {
		return processSingleTask(taskOrData);
	}
	// Check if the input is an array of tasks directly (less common but possible)
	else if (Array.isArray(taskOrData)) {
		return processArrayOfTasks(taskOrData);
	}

	// If it doesn't match known task structures, return it as is
	return taskOrData;
}

/**
 * Creates standard content response for tools
 * @param {string|Object} content - Content to include in response
 * @returns {Object} - Content response object in FastMCP format
 */
function createContentResponse(content) {
	// FastMCP requires text type, so we format objects as JSON strings
	return {
		content: [
			{
				type: 'text',
				text:
					typeof content === 'object'
						? // Format JSON nicely with indentation
							JSON.stringify(content, null, 2)
						: // Keep other content types as-is
							String(content)
			}
		]
	};
}

/**
 * Creates error response for tools
 * @param {string} errorMessage - Error message to include in response
 * @param {Object} [versionInfo] - Optional version information object
 * @param {Object} [tagInfo] - Optional tag information object
 * @returns {Object} - Error content response object in FastMCP format
 */
function createErrorResponse(errorMessage, versionInfo, tagInfo) {
	// Provide fallback version info if not provided
	if (!versionInfo) {
		versionInfo = getVersionInfo();
	}

	let responseText = `Error: ${errorMessage}
Version: ${versionInfo.version}
Name: ${versionInfo.name}`;

	// Add tag information if available
	if (tagInfo) {
		responseText += `
Current Tag: ${tagInfo.currentTag}`;
	}

	return {
		content: [
			{
				type: 'text',
				text: responseText
			}
		],
		isError: true
	};
}

/**
 * Creates a logger wrapper object compatible with core function expectations.
 * Adapts the MCP logger to the { info, warn, error, debug, success } structure.
 * @param {Object} log - The MCP logger instance.
 * @returns {Object} - The logger wrapper object.
 */
function createLogWrapper(log) {
	return {
		info: (message, ...args) => log.info(message, ...args),
		warn: (message, ...args) => log.warn(message, ...args),
		error: (message, ...args) => log.error(message, ...args),
		// Handle optional debug method
		debug: (message, ...args) =>
			log.debug ? log.debug(message, ...args) : null,
		// Map success to info as a common fallback
		success: (message, ...args) => log.info(message, ...args)
	};
}

/**
 * Resolves and normalizes a project root path from various formats.
 * Handles URI encoding, Windows paths, and file protocols.
 * @param {string | undefined | null} rawPath - The raw project root path.
 * @param {object} [log] - Optional logger object.
 * @returns {string | null} Normalized absolute path or null if input is invalid/empty.
 */
function normalizeProjectRoot(rawPath, log) {
	if (!rawPath) return null;
	try {
		let pathString = Array.isArray(rawPath) ? rawPath[0] : String(rawPath);
		if (!pathString) return null;

		// 1. Decode URI Encoding
		// Use try-catch for decoding as malformed URIs can throw
		try {
			pathString = decodeURIComponent(pathString);
		} catch (decodeError) {
			if (log)
				log.warn(
					`Could not decode URI component for path "${rawPath}": ${decodeError.message}. Proceeding with raw string.`
				);
			// Proceed with the original string if decoding fails
			pathString = Array.isArray(rawPath) ? rawPath[0] : String(rawPath);
		}

		// 2. Strip file:// prefix (handle 2 or 3 slashes)
		if (pathString.startsWith('file:///')) {
			pathString = pathString.slice(7); // Slice 7 for file:///, may leave leading / on Windows
		} else if (pathString.startsWith('file://')) {
			pathString = pathString.slice(7); // Slice 7 for file://
		}

		// 3. Handle potential Windows leading slash after stripping prefix (e.g., /C:/...)
		// This checks if it starts with / followed by a drive letter C: D: etc.
		if (
			pathString.startsWith('/') &&
			/[A-Za-z]:/.test(pathString.substring(1, 3))
		) {
			pathString = pathString.substring(1); // Remove the leading slash
		}

		// 4. Normalize backslashes to forward slashes
		pathString = pathString.replace(/\\/g, '/');

		// 5. Resolve to absolute path using server's OS convention
		const resolvedPath = path.resolve(pathString);
		return resolvedPath;
	} catch (error) {
		if (log) {
			log.error(
				`Error normalizing project root path "${rawPath}": ${error.message}`
			);
		}
		return null; // Return null on error
	}
}

/**
 * Extracts the raw project root path from the session (without normalization).
 * Used as a fallback within the HOF.
 * @param {Object} session - The MCP session object.
 * @param {Object} log - The MCP logger object.
 * @returns {string|null} The raw path string or null.
 */
function getRawProjectRootFromSession(session, log) {
	try {
		// Check primary location
		if (session?.roots?.[0]?.uri) {
			return session.roots[0].uri;
		}
		// Check alternate location
		else if (session?.roots?.roots?.[0]?.uri) {
			return session.roots.roots[0].uri;
		}
		return null; // Not found in expected session locations
	} catch (e) {
		log.error(`Error accessing session roots: ${e.message}`);
		return null;
	}
}

/**
 * Higher-order function to wrap MCP tool execute methods.
 * Ensures args.projectRoot is present and normalized before execution.
 * Uses TASK_MASTER_PROJECT_ROOT environment variable with proper precedence.
 * @param {Function} executeFn - The original async execute(args, context) function.
 * @returns {Function} The wrapped async execute function.
 */
function withNormalizedProjectRoot(executeFn) {
	return async (args, context) => {
		const { log, session } = context;
		let normalizedRoot = null;
		let rootSource = 'unknown';

		try {
			// PRECEDENCE ORDER:
			// 1. TASK_MASTER_PROJECT_ROOT environment variable (from process.env or session)
			// 2. args.projectRoot (explicitly provided)
			// 3. Session-based project root resolution
			// 4. Current directory fallback

			// 1. Check for TASK_MASTER_PROJECT_ROOT environment variable first
			if (process.env.TASK_MASTER_PROJECT_ROOT) {
				const envRoot = process.env.TASK_MASTER_PROJECT_ROOT;
				normalizedRoot = path.isAbsolute(envRoot)
					? envRoot
					: path.resolve(process.cwd(), envRoot);
				rootSource = 'TASK_MASTER_PROJECT_ROOT environment variable';
				log.info(`Using project root from ${rootSource}: ${normalizedRoot}`);
			}
			// Also check session environment variables for TASK_MASTER_PROJECT_ROOT
			else if (session?.env?.TASK_MASTER_PROJECT_ROOT) {
				const envRoot = session.env.TASK_MASTER_PROJECT_ROOT;
				normalizedRoot = path.isAbsolute(envRoot)
					? envRoot
					: path.resolve(process.cwd(), envRoot);
				rootSource = 'TASK_MASTER_PROJECT_ROOT session environment variable';
				log.info(`Using project root from ${rootSource}: ${normalizedRoot}`);
			}
			// 2. If no environment variable, try args.projectRoot
			else if (args.projectRoot) {
				normalizedRoot = normalizeProjectRoot(args.projectRoot, log);
				rootSource = 'args.projectRoot';
				log.info(`Using project root from ${rootSource}: ${normalizedRoot}`);
			}
			// 3. If no args.projectRoot, try session-based resolution
			else {
				const sessionRoot = getProjectRootFromSession(session, log);
				if (sessionRoot) {
					normalizedRoot = sessionRoot; // getProjectRootFromSession already normalizes
					rootSource = 'session';
					log.info(`Using project root from ${rootSource}: ${normalizedRoot}`);
				}
			}

			if (!normalizedRoot) {
				log.error(
					'Could not determine project root from environment, args, or session.'
				);
				return createErrorResponse(
					'Could not determine project root. Please provide projectRoot argument or ensure TASK_MASTER_PROJECT_ROOT environment variable is set.'
				);
			}

			// Inject the normalized root back into args
			const updatedArgs = { ...args, projectRoot: normalizedRoot };

			// Execute the original function with normalized root in args
			return await executeFn(updatedArgs, context);
		} catch (error) {
			log.error(
				`Error within withNormalizedProjectRoot HOF (Normalized Root: ${normalizedRoot}): ${error.message}`
			);
			// Add stack trace if available and debug enabled
			if (error.stack && log.debug) {
				log.debug(error.stack);
			}
			// Return a generic error or re-throw depending on desired behavior
			return createErrorResponse(`Operation failed: ${error.message}`);
		}
	};
}

// Ensure all functions are exported
export {
	getProjectRoot,
	getProjectRootFromSession,
	getTagInfo,
	handleApiResult,
	executeTaskMasterCommand,
	getCachedOrExecute,
	processMCPResponseData,
	createContentResponse,
	createErrorResponse,
	createLogWrapper,
	normalizeProjectRoot,
	getRawProjectRootFromSession,
	withNormalizedProjectRoot
};
