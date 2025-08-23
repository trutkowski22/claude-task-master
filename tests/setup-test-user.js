import { supabase, supabaseAdmin } from './mcp-server/src/database/config.js';

const TEST_USER_EMAIL = 'test-migration@example.com';
const TEST_USER_PASSWORD = 'testpassword123';

async function setupTestUser() {
    console.log('Setting up test user in Supabase Auth...');

    try {
        // First, try to create the user in Supabase Auth
        console.log('Creating user in Supabase Auth...');
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: TEST_USER_EMAIL,
            password: TEST_USER_PASSWORD,
            email_confirm: true
        });

        if (authError) {
            console.log('Auth user creation failed:', authError.message);
            // Try to get existing user
            const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
            const existingTestUser = existingUser.users.find(u => u.email === TEST_USER_EMAIL);

            if (existingTestUser) {
                console.log('Using existing test user:', existingTestUser.id);
                return existingTestUser.id;
            } else {
                throw authError;
            }
        }

        const userId = authData.user.id;
        console.log('✅ Auth user created with ID:', userId);

        // Now create the user profile in our users table
        console.log('Creating user profile in database...');
        const { data: profileData, error: profileError } = await supabaseAdmin
            .from('users')
            .upsert({
                id: userId,
                email: TEST_USER_EMAIL,
                display_name: 'Test Migration User',
                settings: { test_user: true }
            })
            .select()
            .single();

        if (profileError) {
            console.log('Profile creation failed:', profileError.message);
            // Try to get existing profile
            const { data: existingProfile } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (existingProfile) {
                console.log('Using existing user profile');
                return userId;
            } else {
                throw profileError;
            }
        }

        console.log('✅ User profile created successfully');
        console.log('User ID:', userId);
        console.log('Email:', TEST_USER_EMAIL);

        return userId;

    } catch (error) {
        console.error('❌ Failed to setup test user:', error.message);
        console.log('Error details:', error);

        // Try alternative approach - list existing users
        try {
            console.log('Attempting to find existing users...');
            const { data: users } = await supabaseAdmin.auth.admin.listUsers();
            if (users && users.users.length > 0) {
                const firstUser = users.users[0];
                console.log('Using existing user:', firstUser.id);
                return firstUser.id;
            }
        } catch (listError) {
            console.error('Could not list users either:', listError.message);
        }

        throw error;
    }
}

async function testUserSetup() {
    try {
        const userId = await setupTestUser();

        console.log('\n' + '='.repeat(50));
        console.log('TEST USER SETUP COMPLETE');
        console.log('=' .repeat(50));
        console.log('User ID:', userId);
        console.log('Email:', TEST_USER_EMAIL);
        console.log('Password:', TEST_USER_PASSWORD);
        console.log('\nYou can now use this user ID for testing the migrated functions.');

        // Save the user ID to a file for later use
        const fs = await import('fs/promises');
        await fs.writeFile('test-user-id.txt', userId);

        console.log('User ID saved to test-user-id.txt');

        return userId;

    } catch (error) {
        console.error('❌ Test user setup failed:', error.message);
        console.log('\nTroubleshooting:');
        console.log('1. Check your Supabase service role key in .env');
        console.log('2. Verify your Supabase project allows user creation');
        console.log('3. Check if RLS policies are blocking user creation');
        return null;
    }
}

// Run the setup
testUserSetup().catch(console.error);