
import { isSilentMode } from '../../scripts/modules/utils.js';
import { getLogLevel } from '../../scripts/modules/config-manager.js';

// Define log levels
const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	success: 4
};

// Get log level from config manager or default to info
const LOG_LEVEL = LOG_LEVELS[getLogLevel().toLowerCase()] ?? LOG_LEVELS.info;

/**
 * Logs a message with the specified level
 * @param {string} level - The log level (debug, info, warn, error, success)
 * @param  {...any} args - Arguments to log
 */
function log(level, ...args) {
	// Skip logging if silent mode is enabled
	if (isSilentMode()) {
		return;
	}

	// Use text prefixes instead of emojis
	const prefixes = {
		debug: '[DEBUG]',
		info: '[INFO]',
		warn: '[WARN]',
		error: '[ERROR]',
		success: '[SUCCESS]'
	};

	if (LOG_LEVELS[level] !== undefined && LOG_LEVELS[level] >= LOG_LEVEL) {
		const prefix = prefixes[level] || '';
		console.log(prefix, ...args);
	}
}

/**
 * Create a logger object with methods for different log levels
 * @returns {Object} Logger object with info, error, debug, warn, and success methods
 */
export function createLogger() {
	const createLogMethod =
		(level) =>
		(...args) =>
			log(level, ...args);

	return {
		debug: createLogMethod('debug'),
		info: createLogMethod('info'),
		warn: createLogMethod('warn'),
		error: createLogMethod('error'),
		success: createLogMethod('success'),
		log: log // Also expose the raw log function
	};
}

// Export a default logger instance
const logger = createLogger();

export default logger;
export { log, LOG_LEVELS };
