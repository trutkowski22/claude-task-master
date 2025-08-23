/**
 * rules-db.js
 * Database-powered implementation for rule profile management
 *
 * This replaces the file-based rules.js with database operations
 */

import { db, DatabaseError } from '../../database/index.js';
import { createLogWrapper } from '../../tools/utils.js';
import { RULE_PROFILES } from '../../../../src/constants/profiles.js';
import { RULES_ACTIONS } from '../../../../src/constants/rules-actions.js';

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
 * Check if a profile name is valid
 * @param {string} profile - Profile name to validate
 * @returns {boolean} True if profile is valid
 */
function isValidProfile(profile) {
	return RULE_PROFILES.includes(profile);
}

/**
 * Get profile display name
 * @param {string} profileName - Profile name
 * @returns {string} Display name for the profile
 */
function getProfileDisplayName(profileName) {
	// For Phase 1, use simple mapping
	const displayNames = {
		'cursor': 'Cursor',
		'cline': 'Cline',
		'codex': 'Codex',
		'roo': 'Roo Code',
		'vscode': 'VS Code',
		'windsurf': 'Windsurf',
		'gemini': 'Gemini'
	};
	return displayNames[profileName] || profileName;
}

/**
 * Get rule profile configuration
 * @param {string} name - Profile name
 * @returns {Object|null} Profile configuration or null if not found
 */
function getRulesProfile(name) {
	// For Phase 1, return basic profile configuration
	// In Phase 2, this would be stored in database
	const profiles = {
		'cursor': {
			displayName: 'Cursor',
			rulesDir: '.cursor/rules',
			profileDir: '.cursor',
			mcpConfig: '.cursor/mcp.json',
			mcpConfigPath: '.cursor/mcp.json'
		},
		'cline': {
			displayName: 'Cline',
			rulesDir: '.cline/rules',
			profileDir: '.cline',
			mcpConfig: false
		},
		'codex': {
			displayName: 'Codex',
			rulesDir: '.codex/rules',
			profileDir: '.codex',
			mcpConfig: false
		},
		'roo': {
			displayName: 'Roo Code',
			rulesDir: '.roo/rules',
			profileDir: '.roo',
			mcpConfig: false
		},
		'vscode': {
			displayName: 'VS Code',
			rulesDir: '.vscode/rules',
			profileDir: '.vscode',
			mcpConfig: false
		},
		'windsurf': {
			displayName: 'Windsurf',
			rulesDir: '.windsurf/rules',
			profileDir: '.windsurf',
			mcpConfig: false
		},
		'gemini': {
			displayName: 'Gemini',
			rulesDir: '.gemini/rules',
			profileDir: '.gemini',
			mcpConfig: false
		}
	};

	return profiles[name] || null;
}

/**
 * Check if removing profiles would leave no profiles installed
 * @param {string} userId - User ID
 * @param {Array} profilesToRemove - Array of profile names to remove
 * @returns {boolean} True if removal would leave no profiles
 */
async function wouldRemovalLeaveNoProfiles(userId, profilesToRemove) {
	try {
		// Get user's current rule profiles from database
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			return true; // No projects means no profiles
		}

		const currentProject = projects[0];
		const currentRules = currentProject.settings?.rules || [];

		// Check if all current profiles would be removed
		const remainingProfiles = currentRules.filter(
			profile => !profilesToRemove.includes(profile)
		);

		return remainingProfiles.length === 0;
	} catch (error) {
		// If we can't determine, assume it's safe (don't block)
		return false;
	}
}

/**
 * Get installed profiles for a user
 * @param {string} userId - User ID
 * @returns {Array} Array of installed profile names
 */
async function getInstalledProfiles(userId) {
	try {
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			return [];
		}

		const currentProject = projects[0];
		return currentProject.settings?.rules || [];
	} catch (error) {
		return [];
	}
}

/**
 * Add rule profiles to a project
 * @param {string} userId - User ID
 * @param {Array} profiles - Array of profile names to add
 * @param {Object} context - Context object with mcpLog, projectRoot
 * @returns {Object} Result object
 */
async function addRuleProfiles(userId, profiles, context) {
	const { mcpLog, projectRoot } = context;
	const report = (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};

	const addResults = [];

	try {
		// Get current project
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			throw new DatabaseError('No projects found for user. Please initialize a project first.');
		}

		const currentProject = projects[0];
		const currentSettings = currentProject.settings || {};
		const currentRules = currentSettings.rules || [];

		for (const profile of profiles) {
			if (!isValidProfile(profile)) {
				addResults.push({
					profileName: profile,
					success: false,
					error: `Profile not found: static import missing for '${profile}'. Valid profiles: ${RULE_PROFILES.join(', ')}`
				});
				continue;
			}

			// Check if profile is already installed
			if (currentRules.includes(profile)) {
				addResults.push({
					profileName: profile,
					success: true,
					skipped: true,
					error: null,
					message: `Profile '${profile}' is already installed`
				});
				continue;
			}

			const profileConfig = getRulesProfile(profile);

			// In Phase 1, we'll simulate rule installation
			// In Phase 2, this would actually create rule files

			// Update project settings to include the new profile
			const updatedRules = [...currentRules, profile];
			const updatedSettings = {
				...currentSettings,
				rules: updatedRules
			};

			await db.projects.update(userId, currentProject.id, {
				settings: updatedSettings
			});

			// Log the change in audit history
			await db.history.log(userId, {
				action: 'rule_profile_added',
				changeSummary: `Added rule profile: ${profile}`,
				projectId: currentProject.id,
				newValue: {
					profile: profile,
					profileConfig: profileConfig
				}
			});

			addResults.push({
				profileName: profile,
				success: true,
				skipped: false,
				error: null,
				message: `Successfully added rule profile: ${profile}`
			});

			report('info', `Added rule profile: ${profile}`);
		}

		const successes = addResults.filter((r) => r.success).map((r) => r.profileName);
		const errors = addResults.filter((r) => r.error && !r.success);

		let summary = '';
		if (successes.length > 0) {
			summary += `Successfully added rules: ${successes.join(', ')}.`;
		}
		if (errors.length > 0) {
			summary += errors
				.map((r) => ` Error adding ${r.profileName}: ${r.error}`)
				.join(' ');
		}

		return {
			success: errors.length === 0,
			data: { summary, results: addResults }
		};

	} catch (error) {
		report('error', `Error adding rule profiles: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'ADD_RULES_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Remove rule profiles from a project
 * @param {string} userId - User ID
 * @param {Array} profiles - Array of profile names to remove
 * @param {Object} context - Context object with mcpLog, projectRoot
 * @returns {Object} Result object
 */
async function removeRuleProfiles(userId, profiles, context) {
	const { mcpLog, projectRoot } = context;
	const report = (level, ...args) => {
		if (mcpLog && typeof mcpLog[level] === 'function') {
			mcpLog[level](...args);
		}
	};

	const removalResults = [];

	try {
		// Get current project
		const projects = await db.projects.list(userId);
		if (!projects || projects.length === 0) {
			throw new DatabaseError('No projects found for user. Please initialize a project first.');
		}

		const currentProject = projects[0];
		const currentSettings = currentProject.settings || {};
		const currentRules = currentSettings.rules || [];

		for (const profile of profiles) {
			if (!isValidProfile(profile)) {
				removalResults.push({
					profileName: profile,
					success: false,
					error: `The requested rule profile for '${profile}' is unavailable. Supported profiles are: ${RULE_PROFILES.join(', ')}.`
				});
				continue;
			}

			// Check if profile is installed
			if (!currentRules.includes(profile)) {
				removalResults.push({
					profileName: profile,
					success: true,
					skipped: true,
					error: null,
					message: `Profile '${profile}' is not installed`
				});
				continue;
			}

			const profileConfig = getRulesProfile(profile);

			// Update project settings to remove the profile
			const updatedRules = currentRules.filter(p => p !== profile);
			const updatedSettings = {
				...currentSettings,
				rules: updatedRules
			};

			await db.projects.update(userId, currentProject.id, {
				settings: updatedSettings
			});

			// Log the change in audit history
			await db.history.log(userId, {
				action: 'rule_profile_removed',
				changeSummary: `Removed rule profile: ${profile}`,
				projectId: currentProject.id,
				oldValue: {
					profile: profile,
					profileConfig: profileConfig
				}
			});

			removalResults.push({
				profileName: profile,
				success: true,
				skipped: false,
				error: null,
				message: `Successfully removed rule profile: ${profile}`
			});

			report('info', `Removed rule profile: ${profile}`);
		}

		const successes = removalResults
			.filter((r) => r.success)
			.map((r) => r.profileName);
		const skipped = removalResults
			.filter((r) => r.skipped)
			.map((r) => r.profileName);
		const errors = removalResults.filter(
			(r) => r.error && !r.success && !r.skipped
		);

		let summary = '';
		if (successes.length > 0) {
			summary += `Successfully removed Task Master rules: ${successes.join(', ')}.`;
		}
		if (skipped.length > 0) {
			summary += `Skipped (not installed): ${skipped.join(', ')}.`;
		}
		if (errors.length > 0) {
			summary += errors
				.map((r) => `Error removing ${r.profileName}: ${r.error}`)
				.join(' ');
		}

		return {
			success: errors.length === 0,
			data: { summary, results: removalResults }
		};

	} catch (error) {
		report('error', `Error removing rule profiles: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'REMOVE_RULES_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Direct function wrapper for rule profile management with database operations
 * @param {Object} args - Command arguments
 * @param {Object} log - Logger object
 * @param {Object} context - Additional context (session)
 * @returns {Promise<Object>} - Result object { success: boolean, data?: any, error?: { code: string, message: string } }
 */
export async function rulesDirect(args, log, context = {}) {
	const {
		action,
		profiles,
		projectRoot,
		yes,
		force
	} = args;

	const { session } = context;
	const mcpLog = createLogWrapper(log);

	if (
		!action ||
		!Array.isArray(profiles) ||
		profiles.length === 0 ||
		!projectRoot
	) {
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'action, profiles, and projectRoot are required.'
			}
		};
	}

	const userId = getUserId(context);

	try {
		if (action === RULES_ACTIONS.REMOVE) {
			// Safety check: Ensure this won't remove all rule profiles (unless forced)
			if (!force && await wouldRemovalLeaveNoProfiles(userId, profiles)) {
				const installedProfiles = await getInstalledProfiles(userId);
				const remainingProfiles = installedProfiles.filter(
					(profile) => !profiles.includes(profile)
				);
				return {
					success: false,
					error: {
						code: 'CRITICAL_REMOVAL_BLOCKED',
						message: `CRITICAL: This operation would remove ALL remaining rule profiles (${profiles.join(', ')}), leaving your project with no rules configurations. This could significantly impact functionality. Currently installed profiles: ${installedProfiles.join(', ')}. If you're certain you want to proceed, set force: true or use the CLI with --force flag.`
					}
				};
			}

			const result = await removeRuleProfiles(userId, profiles, {
				mcpLog,
				projectRoot
			});
			return result;

		} else if (action === RULES_ACTIONS.ADD) {
			const result = await addRuleProfiles(userId, profiles, {
				mcpLog,
				projectRoot
			});
			return result;

		} else {
			return {
				success: false,
				error: {
					code: 'INVALID_ACTION',
					message: `Unknown action. Use "${RULES_ACTIONS.ADD}" or "${RULES_ACTIONS.REMOVE}".`
				}
			};
		}
	} catch (error) {
		log.error(`[rulesDirect] Error: ${error.message}`);
		return {
			success: false,
			error: {
				code: error.code || 'RULES_ERROR',
				message: error.message
			}
		};
	}
}

// Export the database-powered functions for use by other modules
export {
	isValidProfile,
	getProfileDisplayName,
	getRulesProfile,
	wouldRemovalLeaveNoProfiles,
	getInstalledProfiles,
	addRuleProfiles,
	removeRuleProfiles
};
