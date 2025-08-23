/**
 * expand-task.js
 * Database-powered implementation for expanding a task into subtasks
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { expandTaskDirect } from './expand-task-db.js';