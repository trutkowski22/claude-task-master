/**
 * Provider validation constants
 * Defines which providers should be validated against the supported-models.json file
 */

// Providers that have predefined model lists and should be validated
export const VALIDATED_PROVIDERS = [
	'anthropic',
	'openai',
	'google',
	'perplexity',

	'mistral'
];

// Custom providers object for easy named access
export const CUSTOM_PROVIDERS = {
	VERTEX: 'vertex',
	OPENROUTER: 'openrouter',
	OLLAMA: 'ollama',
	CLAUDE_CODE: 'claude-code',
	MCP: 'mcp',
	GEMINI_CLI: 'gemini-cli'
};

// Custom providers array (for backward compatibility and iteration)
export const CUSTOM_PROVIDERS_ARRAY = Object.values(CUSTOM_PROVIDERS);

// All known providers (for reference)
export const ALL_PROVIDERS = [
	...VALIDATED_PROVIDERS,
	...CUSTOM_PROVIDERS_ARRAY
];
