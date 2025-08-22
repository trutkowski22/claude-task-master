/**
 * set-task-status.js
 * Database-powered implementation for setting task status
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { setTaskStatusDirect } from './set-task-status-db.js';
