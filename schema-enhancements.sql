-- Schema Enhancements - Add missing features to quick schema
-- Run this in Supabase SQL Editor to upgrade from quick schema to full schema

-- Add missing columns to existing tables

-- Enhance users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

-- Enhance projects table  
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Enhance tasks table
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS complexity_score INTEGER CHECK (complexity_score >= 1 AND complexity_score <= 10);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS test_strategy TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT[];
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL;

-- Enhance tags table
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add automatic timestamp updating triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at timestamps
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON public.tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subtasks_updated_at ON public.subtasks;
CREATE TRIGGER update_subtasks_updated_at BEFORE UPDATE ON public.subtasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tags_updated_at ON public.tags;
CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON public.tags
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
DROP TRIGGER IF EXISTS assign_task_number_trigger ON public.tasks;
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
DROP TRIGGER IF EXISTS assign_subtask_number_trigger ON public.subtasks;
CREATE TRIGGER assign_subtask_number_trigger BEFORE INSERT ON public.subtasks
    FOR EACH ROW EXECUTE FUNCTION assign_subtask_number();

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON public.tasks(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON public.tasks(user_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_complexity ON public.tasks(complexity_score) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_subtasks_parent_status ON public.subtasks(parent_task_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_tags_performance ON public.task_tags(user_id, task_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_performance ON public.task_dependencies(user_id, task_id, depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_task_history_performance ON public.task_history(user_id, task_id, created_at);

-- Success message
SELECT 'Schema enhancements applied successfully!' as result;