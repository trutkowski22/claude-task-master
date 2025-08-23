-- Task Master Database Schema for Supabase PostgreSQL
-- Multi-tenant architecture with Row-Level Security (RLS)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table (leverages Supabase auth.users)
-- This extends the built-in Supabase auth system
CREATE TABLE IF NOT EXISTS public.users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects table - user workspaces
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMPTZ,
    
    CONSTRAINT projects_name_user_unique UNIQUE(user_id, name)
);

-- Tasks table - main task entities  
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    
    -- Task identification
    task_number INTEGER NOT NULL, -- Sequential number within project/user
    title TEXT NOT NULL,
    description TEXT,
    
    -- Task metadata
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'review', 'done', 'cancelled', 'deferred')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    complexity_score INTEGER CHECK (complexity_score >= 1 AND complexity_score <= 10),
    
    -- Implementation details
    details JSONB DEFAULT '{}',
    test_strategy TEXT,
    acceptance_criteria TEXT[],
    
    -- Timestamps and versioning
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    version INTEGER DEFAULT 1 NOT NULL,
    
    -- Ensure unique task numbers per user/project
    CONSTRAINT tasks_number_user_unique UNIQUE(user_id, project_id, task_number)
);

-- Subtasks table - hierarchical task breakdown
CREATE TABLE IF NOT EXISTS public.subtasks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    parent_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
    
    -- Subtask identification  
    subtask_number INTEGER NOT NULL, -- Sequential within parent task
    title TEXT NOT NULL,
    description TEXT,
    
    -- Subtask metadata
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'review', 'done', 'cancelled', 'deferred')),
    details JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    
    -- Ensure unique subtask numbers per parent task
    CONSTRAINT subtasks_number_parent_unique UNIQUE(parent_task_id, subtask_number)
);

-- Tags table - flexible tagging system
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT, -- Hex color code
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    CONSTRAINT tags_name_user_unique UNIQUE(user_id, name)
);

-- Task-Tag many-to-many relationship
CREATE TABLE IF NOT EXISTS public.task_tags (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
    tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    CONSTRAINT task_tags_unique UNIQUE(task_id, tag_id)
);

-- Task dependencies - directed graph
CREATE TABLE IF NOT EXISTS public.task_dependencies (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
    depends_on_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Prevent self-dependencies and duplicates
    CONSTRAINT no_self_dependency CHECK (task_id != depends_on_task_id),
    CONSTRAINT task_dependencies_unique UNIQUE(task_id, depends_on_task_id)
);

-- Task history/audit trail
CREATE TABLE IF NOT EXISTS public.task_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
    subtask_id UUID REFERENCES public.subtasks(id) ON DELETE CASCADE,

    -- Change tracking
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'status_changed', 'assigned', 'moved')),
    field_name TEXT,
    old_value JSONB,
    new_value JSONB,
    change_summary TEXT,

    -- Context
    changed_by UUID REFERENCES public.users(id),
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Either task_id or subtask_id must be set, but not both
    CONSTRAINT history_task_or_subtask CHECK (
        (task_id IS NOT NULL AND subtask_id IS NULL) OR
        (task_id IS NULL AND subtask_id IS NOT NULL)
    )
);

-- Complexity reports table - stores complexity analysis results
CREATE TABLE IF NOT EXISTS public.complexity_reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,

    -- Report metadata
    name TEXT NOT NULL,
    description TEXT,
    report_data JSONB NOT NULL, -- The actual complexity analysis data

    -- Source information
    source TEXT DEFAULT 'generated' CHECK (source IN ('generated', 'file', 'imported')),
    source_path TEXT, -- Original file path if imported from file

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Unique constraint for user/project/name combination
    CONSTRAINT complexity_reports_user_project_name_unique UNIQUE(user_id, project_id, name)
);

-- Cache statistics table - stores cache performance metrics
CREATE TABLE IF NOT EXISTS public.cache_stats (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,

    -- Statistics data
    stats_data JSONB NOT NULL, -- The actual cache statistics

    -- Recording information
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON public.projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_complexity_reports_user_id ON public.complexity_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_complexity_reports_project_id ON public.complexity_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_complexity_reports_created_at ON public.complexity_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_stats_user_id ON public.cache_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_cache_stats_recorded_at ON public.cache_stats(recorded_at);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON public.projects(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON public.tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON public.tasks(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_task_number ON public.tasks(user_id, task_number);

CREATE INDEX IF NOT EXISTS idx_subtasks_user_id ON public.subtasks(user_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_parent_task_id ON public.subtasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_status ON public.subtasks(status);
CREATE INDEX IF NOT EXISTS idx_subtasks_deleted_at ON public.subtasks(deleted_at);

CREATE INDEX IF NOT EXISTS idx_tags_user_id ON public.tags(user_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task_id ON public.task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON public.task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_user_id ON public.task_tags(user_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON public.task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON public.task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_user_id ON public.task_dependencies(user_id);

CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON public.task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_history_subtask_id ON public.task_history(subtask_id);
CREATE INDEX IF NOT EXISTS idx_task_history_user_id ON public.task_history(user_id);
CREATE INDEX IF NOT EXISTS idx_task_history_created_at ON public.task_history(created_at);

-- Row Level Security (RLS) Policies
-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complexity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cache_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for projects table
CREATE POLICY "Users can view own projects" ON public.projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own projects" ON public.projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON public.projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" ON public.projects
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for tasks table
CREATE POLICY "Users can view own tasks" ON public.tasks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tasks" ON public.tasks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks" ON public.tasks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks" ON public.tasks
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for subtasks table
CREATE POLICY "Users can view own subtasks" ON public.subtasks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own subtasks" ON public.subtasks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subtasks" ON public.subtasks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own subtasks" ON public.subtasks
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for tags table
CREATE POLICY "Users can view own tags" ON public.tags
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tags" ON public.tags
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tags" ON public.tags
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tags" ON public.tags
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for task_tags table
CREATE POLICY "Users can view own task tags" ON public.task_tags
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own task tags" ON public.task_tags
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own task tags" ON public.task_tags
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for task_dependencies table
CREATE POLICY "Users can view own task dependencies" ON public.task_dependencies
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own task dependencies" ON public.task_dependencies
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own task dependencies" ON public.task_dependencies
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for task_history table
CREATE POLICY "Users can view own task history" ON public.task_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create task history" ON public.task_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for complexity_reports table
CREATE POLICY "Users can view own complexity reports" ON public.complexity_reports
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own complexity reports" ON public.complexity_reports
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own complexity reports" ON public.complexity_reports
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own complexity reports" ON public.complexity_reports
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for cache_stats table
CREATE POLICY "Users can view own cache stats" ON public.cache_stats
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own cache stats" ON public.cache_stats
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cache stats" ON public.cache_stats
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cache stats" ON public.cache_stats
    FOR DELETE USING (auth.uid() = user_id);

-- Functions for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at timestamps
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subtasks_updated_at BEFORE UPDATE ON public.subtasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON public.tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_complexity_reports_updated_at BEFORE UPDATE ON public.complexity_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cache_stats_updated_at BEFORE UPDATE ON public.cache_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically assign task numbers
CREATE OR REPLACE FUNCTION assign_task_number()
RETURNS TRIGGER AS $$
BEGIN
    -- If task_number is not provided, assign the next available number
    IF NEW.task_number IS NULL THEN
        SELECT COALESCE(MAX(task_number), 0) + 1 
        INTO NEW.task_number
        FROM public.tasks 
        WHERE user_id = NEW.user_id 
        AND (project_id = NEW.project_id OR (project_id IS NULL AND NEW.project_id IS NULL))
        AND deleted_at IS NULL;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for automatic task numbering
CREATE TRIGGER assign_task_number_trigger BEFORE INSERT ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION assign_task_number();

-- Function to automatically assign subtask numbers
CREATE OR REPLACE FUNCTION assign_subtask_number()
RETURNS TRIGGER AS $$
BEGIN
    -- If subtask_number is not provided, assign the next available number
    IF NEW.subtask_number IS NULL THEN
        SELECT COALESCE(MAX(subtask_number), 0) + 1 
        INTO NEW.subtask_number
        FROM public.subtasks 
        WHERE parent_task_id = NEW.parent_task_id 
        AND deleted_at IS NULL;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for automatic subtask numbering
CREATE TRIGGER assign_subtask_number_trigger BEFORE INSERT ON public.subtasks
    FOR EACH ROW EXECUTE FUNCTION assign_subtask_number();