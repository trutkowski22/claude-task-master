/**
 * move-task.js
 * Database-powered implementation for moving tasks to new positions
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { moveTaskDirect } from './move-task-db.js';
