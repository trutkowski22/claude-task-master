/**
 * validate-dependencies.js
 * Database-powered implementation for validating task dependencies
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { validateDependenciesDirect } from './validate-dependencies-db.js';