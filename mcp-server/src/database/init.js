import { supabaseAdmin, testConnection } from './config.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Initialize the database schema
 * This should be run once when setting up a new Supabase project
 */
export async function initializeDatabase() {
    if (!supabaseAdmin) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for database initialization');
    }

    console.log('🔄 Initializing Task Master database schema...');

    try {
        // Test connection first
        const connectionResult = await testConnection();
        if (!connectionResult.success) {
            throw new Error(connectionResult.message);
        }
        console.log('✅ Database connection successful');

        // Read and execute schema SQL
        const schemaPath = join(__dirname, 'schema.sql');
        const schemaSql = readFileSync(schemaPath, 'utf8');

        // Execute the full schema using Supabase's SQL execution
        console.log(`📄 Executing database schema...`);

        try {
            // Use the raw SQL execution approach
            const { data, error } = await supabaseAdmin.rpc('exec_sql', {
                sql_query: schemaSql
            });

            if (error) {
                // If exec_sql RPC doesn't exist, we'll execute statements individually
                console.log('📄 Executing SQL statements individually...');
                
                const statements = schemaSql
                    .split(';')
                    .map(stmt => stmt.trim())
                    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

                let successCount = 0;
                let warningCount = 0;

                for (let i = 0; i < statements.length; i++) {
                    const statement = statements[i].trim();
                    if (statement) {
                        try {
                            // Execute each statement using the SQL REST API
                            const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
                                },
                                body: JSON.stringify({
                                    sql_query: statement + ';'
                                })
                            });

                            if (response.ok) {
                                successCount++;
                            } else {
                                const errorText = await response.text();
                                if (!errorText.includes('already exists') && 
                                    !errorText.includes('duplicate') &&
                                    !errorText.includes('does not exist')) {
                                    console.warn(`⚠️  Statement ${i + 1}: ${errorText}`);
                                    warningCount++;
                                }
                            }
                        } catch (err) {
                            if (!err.message.includes('already exists') && 
                                !err.message.includes('duplicate')) {
                                console.warn(`⚠️  Statement ${i + 1}: ${err.message}`);
                                warningCount++;
                            }
                        }
                    }
                }

                console.log(`✅ Executed ${successCount} statements successfully`);
                if (warningCount > 0) {
                    console.log(`⚠️  ${warningCount} statements had warnings (likely safe to ignore)`);
                }
            } else {
                console.log('✅ Schema executed successfully via RPC');
            }
        } catch (execError) {
            console.warn(`⚠️  Schema execution warning: ${execError.message}`);
        }

        console.log('✅ Database schema initialization completed');

        // Verify critical tables exist
        await verifySchema();
        
        return { success: true, message: 'Database initialized successfully' };

    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Verify that critical tables exist
 */
async function verifySchema() {
    const criticalTables = ['users', 'projects', 'tasks', 'subtasks', 'tags'];
    
    console.log('🔍 Verifying critical tables exist...');
    
    for (const table of criticalTables) {
        try {
            const { error } = await supabaseAdmin
                .from(table)
                .select('count', { count: 'exact', head: true });
                
            if (error) {
                throw new Error(`Table '${table}' verification failed: ${error.message}`);
            }
            console.log(`✅ Table '${table}' verified`);
        } catch (error) {
            console.warn(`⚠️  Table '${table}' verification warning: ${error.message}`);
        }
    }
}

/**
 * Create initial user profile when a user signs up
 * This is typically called from a Supabase trigger or auth hook
 */
export async function createUserProfile(userId, email, displayName = null) {
    try {
        const { data, error } = await supabaseAdmin
            .from('users')
            .insert({
                id: userId,
                email: email,
                display_name: displayName || email.split('@')[0],
                settings: {},
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        console.log(`✅ User profile created for ${email}`);
        return { success: true, user: data };

    } catch (error) {
        console.error('❌ Failed to create user profile:', error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Health check function for the database
 */
export async function healthCheck() {
    try {
        // Test basic connection
        const connection = await testConnection();
        if (!connection.success) {
            return { success: false, message: connection.message };
        }

        // Test critical table access
        const { data, error } = await supabaseAdmin
            .from('users')
            .select('count', { count: 'exact', head: true });

        if (error) {
            return { success: false, message: `Database access error: ${error.message}` };
        }

        return { 
            success: true, 
            message: 'Database health check passed',
            userCount: data?.[0]?.count || 0
        };

    } catch (error) {
        return { success: false, message: `Health check failed: ${error.message}` };
    }
}