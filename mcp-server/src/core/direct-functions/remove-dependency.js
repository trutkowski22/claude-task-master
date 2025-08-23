/**
 * remove-dependency.js
 * Database-powered implementation for removing a dependency from a task
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { removeDependencyDirect } from './remove-dependency-db.js';