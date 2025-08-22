#!/usr/bin/env node

/**
 * Database Setup Script for Task Master
 * 
 * This script initializes the Supabase database with the required schema.
 * Run this after setting up your Supabase project and configuring environment variables.
 */

import { supabaseAdmin, testConnection, TABLES } from './mcp-server/src/database/config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
    console.log('🚀 Task Master Database Setup');
    console.log('================================\n');

    // Check if we have the required environment variables
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.error('❌ Missing required environment variables:');
        console.error('   - SUPABASE_URL');
        console.error('   - SUPABASE_ANON_KEY');
        console.error('   - SUPABASE_SERVICE_ROLE_KEY (for initialization)');
        console.error('\nPlease copy .env.example to .env and configure your Supabase credentials.');
        process.exit(1);
    }

    if (!supabaseAdmin) {
        console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required for database setup');
        console.error('   Please add your service role key to the .env file');
        process.exit(1);
    }

    try {
        // Test basic connection
        console.log('🔄 Testing database connection...');
        const connectionTest = await testConnection();
        if (!connectionTest.success) {
            throw new Error(connectionTest.message);
        }
        console.log('✅ Database connection successful\n');

        // Initialize schema
        console.log('🔄 Setting up database schema...');
        await initializeSchema();
        console.log('✅ Database schema setup complete\n');

        // Verify setup
        console.log('🔄 Verifying database setup...');
        await verifySetup();
        console.log('✅ Database verification complete\n');

        console.log('🎉 Database setup completed successfully!');
        console.log('\nNext steps:');
        console.log('1. Your database is ready for Task Master');
        console.log('2. You can now run the MCP server');
        console.log('3. Proceed with Phase 1.3: Core Function Migration');

    } catch (error) {
        console.error('❌ Database setup failed:', error.message);
        console.error('\nTroubleshooting:');
        console.error('1. Verify your Supabase credentials in .env');
        console.error('2. Check that your Supabase project is active');
        console.error('3. Ensure the service role key has admin permissions');
        process.exit(1);
    }
}

async function initializeSchema() {
    const { initializeDatabase } = await import('./mcp-server/src/database/init.js');
    
    try {
        const result = await initializeDatabase();
        if (!result.success) {
            throw new Error(result.message);
        }
        console.log('✅ Schema initialization completed');
    } catch (error) {
        console.error('Schema execution error:', error.message);
        throw error;
    }
}

async function verifySetup() {
    const criticalTables = Object.values(TABLES);
    
    for (const table of criticalTables) {
        try {
            const { count, error } = await supabaseAdmin
                .from(table)
                .select('*', { count: 'exact', head: true });
                
            if (error) {
                throw new Error(`Table '${table}' not found: ${error.message}`);
            }
            
            console.log(`✅ Table '${table}' verified (${count || 0} rows)`);
        } catch (error) {
            console.warn(`⚠️  Table '${table}': ${error.message}`);
        }
    }
}

function waitForUserInput() {
    return new Promise((resolve) => {
        process.stdin.once('data', () => {
            resolve();
        });
    });
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n\n⏹️  Setup interrupted by user');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n⏹️  Setup terminated');
    process.exit(0);
});

// Run the setup
main().catch(console.error);