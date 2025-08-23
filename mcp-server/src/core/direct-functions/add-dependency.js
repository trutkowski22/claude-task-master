/**
 * add-dependency.js
 * Database-powered implementation for adding a dependency to a task
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { addDependencyDirect } from './add-dependency-db.js';