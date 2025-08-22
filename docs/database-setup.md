# Database Setup Guide - Task Master with Supabase

This guide walks you through setting up the Supabase database for Task Master's cloud migration.

## Prerequisites

1. **Supabase Account**: Sign up at [supabase.com](https://supabase.com)
2. **Node.js 18+**: Required for running the setup scripts

## Step 1: Create Supabase Project

1. Go to the [Supabase Dashboard](https://app.supabase.com)
2. Click **"New Project"**
3. Choose your organization
4. Fill in project details:
   - **Name**: `task-master-production` (or your preferred name)
   - **Database Password**: Generate a strong password and save it
   - **Region**: Choose closest to your users
5. Click **"Create new project"**

## Step 2: Get Supabase Credentials

Once your project is created:

1. Go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (e.g., `https://your-project.supabase.co`)
   - **Anon public key** (starts with `eyJ...`)
   - **Service role secret key** (starts with `eyJ...`)

## Step 3: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update the Supabase configuration in `.env`:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

## Step 4: Initialize Database Schema

Run the database initialization script:

```bash
node mcp-server/src/database/init.js
```

This will:
- Create all required tables (users, projects, tasks, subtasks, tags, etc.)
- Set up Row-Level Security (RLS) policies
- Create indexes for performance
- Set up triggers for automatic timestamps and numbering

## Step 5: Verify Setup

Test the database connection:

```bash
node -e "
import { healthCheck } from './mcp-server/src/database/init.js';
healthCheck().then(result => console.log(result));
"
```

You should see:
```json
{
  "success": true,
  "message": "Database health check passed",
  "userCount": 0
}
```

## Database Schema Overview

### Core Tables

- **`users`**: User profiles (extends Supabase auth.users)
- **`projects`**: User workspaces/projects
- **`tasks`**: Main task entities with full metadata
- **`subtasks`**: Hierarchical task breakdown
- **`tags`**: Flexible tagging system
- **`task_tags`**: Many-to-many task-tag relationships
- **`task_dependencies`**: Task dependency graph
- **`task_history`**: Complete audit trail

### Key Features

- **Multi-tenant**: All data scoped by user_id with RLS
- **Automatic numbering**: Tasks and subtasks get sequential numbers
- **Soft deletes**: Data marked as deleted, not removed
- **Audit trail**: Complete history of all changes
- **Performance optimized**: Strategic indexes for common queries

## Security Features

### Row-Level Security (RLS)

All tables have RLS enabled with policies ensuring users can only access their own data:

```sql
-- Example policy
CREATE POLICY "Users can view own tasks" ON public.tasks
    FOR SELECT USING (auth.uid() = user_id);
```

### Authentication Integration

- Leverages Supabase's built-in authentication
- JWT tokens for secure API access
- User profiles automatically linked to auth.users

## Migration from File System

The database is designed to support migration from the existing file-based system:

1. **Preserve task IDs**: Existing task numbering maintained
2. **Metadata preservation**: All existing fields mapped to JSONB columns
3. **Bulk import support**: Optimized for efficient data loading

## Performance Considerations

- **Connection pooling**: Configured for optimal concurrent access
- **Query optimization**: Indexes on frequently queried columns
- **Pagination**: Built-in support for efficient large data sets
- **Caching**: Ready for Redis integration in future phases

## Troubleshooting

### Common Issues

1. **Connection fails**: Verify SUPABASE_URL and keys are correct
2. **RLS blocks queries**: Ensure user is authenticated and user_id matches
3. **Schema errors**: Check that initialization completed successfully

### Debug Mode

Enable debug logging:
```env
LOG_LEVEL=debug
```

### Manual Schema Reset

If you need to reset the schema:

1. Go to Supabase Dashboard → SQL Editor
2. Run: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
3. Re-run the initialization script

## Next Steps

With the database setup complete, you're ready for:

1. **Core Function Migration**: Update all 31 functions to use database operations
2. **Authentication Integration**: Implement JWT-based user authentication
3. **MCP Tool Updates**: Add user context to all MCP operations

See `migration_implementation_guide.md` for the complete migration roadmap.