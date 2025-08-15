/**
 * @typedef {'claude' | 'cline' | 'codex' | 'cursor' | 'gemini' |'roo' | 'vscode' |} RulesProfile
 */

/**
 * Available rule profiles for project initialization and rules command
 *
 * ⚠️  SINGLE SOURCE OF TRUTH: This is the authoritative list of all supported rule profiles.
 * This constant is used directly throughout the codebase (previously aliased as PROFILE_NAMES).
 *
 * @type {RulesProfile[]}
 * @description Defines possible rule profile sets:
 * - claude: Claude Code integration
 * - cline: Cline IDE rules
 * - codex: Codex integration
 * - cursor: Cursor IDE rules
 * - gemini: Gemini integration
 * - roo: Roo Code IDE rules
 * - vscode: VS Code with GitHub Copilot integration
 *
 * To add a new rule profile:
 * 1. Add the profile name to this array
 * 2. Create a profile file in src/profiles/{profile}.js
 * 3. Export it as {profile}Profile in src/profiles/index.js
 */
export const RULE_PROFILES = [
	'claude',
	'cline',
	'codex',
	'cursor',
	'gemini',
	'roo',
	'vscode',

];

/**
 * Centralized enum for all supported Roo agent modes
 * @type {string[]}
 * @description Available Roo Code IDE modes for rule generation
 */
export const ROO_MODES = [
	'architect',
	'ask',
	'orchestrator',
	'code',
	'debug',
	'test'
];

/**
 * Check if a given rule profile is valid
 * @param {string} rulesProfile - The rule profile to check
 * @returns {boolean} True if the rule profile is valid, false otherwise
 */
export function isValidRulesProfile(rulesProfile) {
	return RULE_PROFILES.includes(rulesProfile);
}
