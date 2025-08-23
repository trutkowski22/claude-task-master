/**
 * rename-tag.js
 * Database-powered implementation for renaming a tag
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { renameTagDirect } from './rename-tag-db.js';