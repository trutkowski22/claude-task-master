/**
 * cache-stats-db.js
 * Database-powered implementation for cache statistics functionality
 *
 * This replaces the file-based cache-stats.js with database operations
 */

import { createLogWrapper } from '../../tools/utils.js';
import { DatabaseError } from '../../database/index.js';
import { supabase } from '../../database/config.js';

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
 * CACHE STATISTICS OPERATIONS
 * TODO: Add these to the main database operations module when ready
 */
const CacheStatsOps = {
	/**
	 * Store cache statistics in database
	 */
	async create(userId, statsData) {
		const response = await supabase
			.from('cache_stats')
			.insert({
				user_id: userId,
				stats_data: statsData,
				recorded_at: new Date().toISOString()
			})
			.select()
			.single();

		if (response.error) {
			throw new DatabaseError(`Failed to store cache stats: ${response.error.message}`, response.error.code);
		}

		return response.data;
	},

	/**
	 * Retrieve latest cache statistics from database
	 */
	async getLatest(userId) {
		const response = await supabase
			.from('cache_stats')
			.select('*')
			.eq('user_id', userId)
			.order('recorded_at', { ascending: false })
			.limit(1);

		if (response.error) {
			throw new DatabaseError(`Failed to retrieve cache stats: ${response.error.message}`, response.error.code);
		}

		if (!response.data || response.data.length === 0) {
			return null;
		}

		return response.data[0];
	},

	/**
	 * Get cache stats by ID
	 */
	async getById(userId, statsId) {
		const response = await supabase
			.from('cache_stats')
			.select('*')
			.eq('id', statsId)
			.eq('user_id', userId)
			.single();

		if (response.error) {
			throw new DatabaseError(`Failed to retrieve cache stats: ${response.error.message}`, response.error.code);
		}

		return response.data;
	},

	/**
	 * Get cache stats history for a user
	 */
	async getHistory(userId, limit = 10) {
		const response = await supabase
			.from('cache_stats')
			.select('*')
			.eq('user_id', userId)
			.order('recorded_at', { ascending: false })
			.limit(limit);

		if (response.error) {
			throw new DatabaseError(`Failed to retrieve cache stats history: ${response.error.message}`, response.error.code);
		}

		return response.data;
	}
};

/**
 * Database-powered cache statistics function
 * @param {string} userId - User ID
 * @param {Object} args - Cache stats arguments
 * @param {Object} log - Logger object
 * @param {Object} context - Additional context
 * @returns {Promise<Object>} - Result object
 */
async function getCacheStatsDb(userId, args, log, context = {}) {
	try {
		// Validate user ID
		if (!userId) {
			throw new DatabaseError('User ID is required for cache stats operations');
		}

		log.info(`Performing database-powered cache stats for user: ${userId}`);

		// Try to get latest cache stats from database
		let dbStats = await CacheStatsOps.getLatest(userId);

		if (dbStats) {
			return {
				success: true,
				data: {
					stats: dbStats.stats_data,
					statsId: dbStats.id,
					recorded_at: dbStats.recorded_at,
					source: 'database'
				}
			};
		}

		// If no database stats found, return empty stats with option to store
		return {
			success: true,
			data: {
				stats: {
					hitCount: 0,
					missCount: 0,
					totalRequests: 0,
					hitRate: 0,
					cacheSize: 0,
					lastUpdated: new Date().toISOString()
				},
				source: 'empty',
				message: 'No cache statistics found in database'
			}
		};

	} catch (error) {
		log.error(`Error in getCacheStatsDb: ${error.message}`);

		throw new DatabaseError(`Failed to retrieve cache stats: ${error.message}`, error.code);
	}
}

/**
 * Direct function wrapper for cache stats with database operations
 *
 * This is the main entry point that replaces the file-based getCacheStatsDirect function
 */
export async function getCacheStatsDirect(args, log, context = {}) {
	// Create logger wrapper
	const mcpLog = createLogWrapper(log);

	try {
		// Extract user ID from context (will be from JWT in Phase 2)
		const userId = getUserId(context);

		// Call the database-powered cache stats function
		const result = await getCacheStatsDb(
			userId,
			args,
			log,
			context
		);

		return result;

	} catch (error) {
		log.error(`Error in getCacheStatsDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: error.code || 'CACHE_STATS_ERROR',
				message: error.message
			}
		};
	}
}