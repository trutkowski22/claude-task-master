/**
 * cache-stats.js
 * Database-powered implementation for cache statistics functionality
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { getCacheStatsDirect } from './cache-stats-db.js';
