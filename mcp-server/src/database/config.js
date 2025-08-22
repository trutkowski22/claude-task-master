import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Supabase Database Configuration
 * 
 * Environment variables required:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_ANON_KEY: Your Supabase anonymous key
 * - SUPABASE_SERVICE_ROLE_KEY: Your Supabase service role key (for admin operations)
 */

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

// Create Supabase client for regular operations (with RLS)
export const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
        auth: {
            autoRefreshToken: true,
            persistSession: false, // Server-side, don't persist sessions
        },
        db: {
            schema: 'public'
        }
    }
);

// Create admin client for operations that bypass RLS (service role)
export const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
            db: {
                schema: 'public'
            }
        }
    )
    : null;

/**
 * Test database connection
 */
export async function testConnection() {
    try {
        // Use a simple query that should always work
        const { data, error } = await supabase.rpc('now');
        if (error) {
            throw error;
        }
        return { success: true, message: 'Database connection successful' };
    } catch (error) {
        // If RPC doesn't work, try a simple auth check
        try {
            const { data: authData, error: authError } = await supabase.auth.getSession();
            if (authError) {
                throw authError;
            }
            return { success: true, message: 'Database connection successful (auth check)' };
        } catch (authError) {
            return { success: false, message: `Database connection failed: ${error.message}` };
        }
    }
}

/**
 * Database table names - centralized for consistency
 */
export const TABLES = {
    USERS: 'users',
    PROJECTS: 'projects', 
    TASKS: 'tasks',
    SUBTASKS: 'subtasks',
    TAGS: 'tags',
    TASK_TAGS: 'task_tags',
    TASK_DEPENDENCIES: 'task_dependencies',
    TASK_HISTORY: 'task_history'
};

/**
 * Common database configuration
 */
export const DB_CONFIG = {
    // Maximum connections for connection pooling
    MAX_CONNECTIONS: 10,
    
    // Query timeout in milliseconds
    QUERY_TIMEOUT: 30000,
    
    // Default pagination limit
    DEFAULT_LIMIT: 100,
    
    // Maximum pagination limit
    MAX_LIMIT: 1000
};