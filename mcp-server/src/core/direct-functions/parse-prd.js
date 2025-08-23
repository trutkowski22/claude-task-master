/**
 * parse-prd.js
 * Database-powered implementation for parsing PRD documents
 * Migrated from file-based operations to Supabase database
 */

// Import the new database-powered implementation
export { parsePRDDirect } from './parse-prd-db.js';
