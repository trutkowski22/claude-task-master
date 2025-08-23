/**
 * expand-all-tasks.js
 * Database-powered implementation for expanding all tasks with subtasks
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { expandAllTasksDirect } from './expand-all-tasks-db.js';