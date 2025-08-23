/**
 * fix-dependencies.js
 * Database-powered implementation for fixing invalid task dependencies
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { fixDependenciesDirect } from './fix-dependencies-db.js';