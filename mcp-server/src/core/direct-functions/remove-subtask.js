/**
 * remove-subtask.js
 * Database-powered implementation for removing subtasks from parent tasks
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { removeSubtaskDirect } from './remove-subtask-db.js';
