-- Advanced Database Functions for Task Master
-- These functions provide complex operations that are more efficient when run on the database side

-- Function to get next available tasks (no pending dependencies)
CREATE OR REPLACE FUNCTION get_next_available_tasks(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    task_number INTEGER,
    title TEXT,
    description TEXT,
    status TEXT,
    priority TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) 
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        t.id,
        t.task_number,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.created_at,
        t.updated_at
    FROM tasks t
    WHERE t.user_id = p_user_id
        AND t.deleted_at IS NULL
        AND t.status IN ('pending', 'in-progress')
        AND NOT EXISTS (
            -- Check if task has any incomplete dependencies
            SELECT 1 
            FROM task_dependencies td
            JOIN tasks dep_task ON td.depends_on_task_id = dep_task.id
            WHERE td.task_id = t.id
                AND td.user_id = p_user_id
                AND dep_task.status NOT IN ('done', 'cancelled')
                AND dep_task.deleted_at IS NULL
        )
    ORDER BY 
        CASE t.priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
        END,
        t.task_number;
$$;

-- Function to get blocked tasks (tasks with incomplete dependencies)
CREATE OR REPLACE FUNCTION get_blocked_tasks(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    task_number INTEGER,
    title TEXT,
    status TEXT,
    blocking_dependencies JSONB
) 
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        t.id,
        t.task_number,
        t.title,
        t.status,
        jsonb_agg(
            jsonb_build_object(
                'id', dep_task.id,
                'task_number', dep_task.task_number,
                'title', dep_task.title,
                'status', dep_task.status
            )
        ) as blocking_dependencies
    FROM tasks t
    JOIN task_dependencies td ON t.id = td.task_id
    JOIN tasks dep_task ON td.depends_on_task_id = dep_task.id
    WHERE t.user_id = p_user_id
        AND t.deleted_at IS NULL
        AND t.status IN ('pending', 'in-progress')
        AND dep_task.status NOT IN ('done', 'cancelled')
        AND dep_task.deleted_at IS NULL
        AND td.user_id = p_user_id
    GROUP BY t.id, t.task_number, t.title, t.status
    ORDER BY t.task_number;
$$;

-- Function to detect circular dependencies
CREATE OR REPLACE FUNCTION check_circular_dependency(
    p_user_id UUID,
    p_task_id UUID,
    p_depends_on_task_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    visited_tasks UUID[] := ARRAY[]::UUID[];
    current_task UUID := p_depends_on_task_id;
BEGIN
    -- Check if adding this dependency would create a cycle
    WHILE current_task IS NOT NULL LOOP
        -- If we've already visited this task, we have a cycle
        IF current_task = ANY(visited_tasks) OR current_task = p_task_id THEN
            RETURN TRUE;
        END IF;
        
        -- Add current task to visited list
        visited_tasks := array_append(visited_tasks, current_task);
        
        -- Get the next task in the dependency chain
        SELECT depends_on_task_id INTO current_task
        FROM task_dependencies
        WHERE user_id = p_user_id 
            AND task_id = current_task
        LIMIT 1;
    END LOOP;
    
    RETURN FALSE;
END;
$$;

-- Function to get task completion statistics
CREATE OR REPLACE FUNCTION get_task_completion_stats(
    p_user_id UUID,
    p_project_id UUID DEFAULT NULL,
    p_date_from TIMESTAMPTZ DEFAULT NULL,
    p_date_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    total_tasks INTEGER,
    completed_tasks INTEGER,
    pending_tasks INTEGER,
    in_progress_tasks INTEGER,
    review_tasks INTEGER,
    cancelled_tasks INTEGER,
    deferred_tasks INTEGER,
    completion_rate NUMERIC,
    avg_completion_time_hours NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    WITH task_stats AS (
        SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'done') as completed,
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status = 'in-progress') as in_progress,
            COUNT(*) FILTER (WHERE status = 'review') as review,
            COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
            COUNT(*) FILTER (WHERE status = 'deferred') as deferred,
            AVG(
                CASE 
                    WHEN status = 'done' AND completed_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0
                    ELSE NULL 
                END
            ) as avg_hours
        FROM tasks 
        WHERE user_id = p_user_id
            AND deleted_at IS NULL
            AND (p_project_id IS NULL OR project_id = p_project_id)
            AND (p_date_from IS NULL OR created_at >= p_date_from)
            AND (p_date_to IS NULL OR created_at <= p_date_to)
    )
    SELECT 
        total::INTEGER,
        completed::INTEGER,
        pending::INTEGER,
        in_progress::INTEGER,
        review::INTEGER,
        cancelled::INTEGER,
        deferred::INTEGER,
        CASE 
            WHEN total > 0 THEN ROUND((completed::NUMERIC / total::NUMERIC) * 100, 2)
            ELSE 0 
        END as completion_rate,
        ROUND(avg_hours, 2) as avg_completion_time_hours
    FROM task_stats;
$$;

-- Function to reorder task numbers after deletion
CREATE OR REPLACE FUNCTION reorder_task_numbers(
    p_user_id UUID,
    p_project_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    task_record RECORD;
    new_number INTEGER := 1;
    updated_count INTEGER := 0;
BEGIN
    -- Update task numbers to be sequential
    FOR task_record IN 
        SELECT id, task_number
        FROM tasks 
        WHERE user_id = p_user_id
            AND (p_project_id IS NULL OR project_id = p_project_id)
            AND deleted_at IS NULL
        ORDER BY task_number
    LOOP
        IF task_record.task_number != new_number THEN
            UPDATE tasks 
            SET task_number = new_number, updated_at = NOW()
            WHERE id = task_record.id;
            updated_count := updated_count + 1;
        END IF;
        new_number := new_number + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$;

-- Function to get task dependency tree
CREATE OR REPLACE FUNCTION get_task_dependency_tree(
    p_user_id UUID,
    p_task_id UUID
)
RETURNS TABLE (
    task_id UUID,
    task_number INTEGER,
    title TEXT,
    status TEXT,
    level INTEGER,
    path TEXT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    WITH RECURSIVE dependency_tree AS (
        -- Base case: start with the specified task
        SELECT 
            t.id as task_id,
            t.task_number,
            t.title,
            t.status,
            0 as level,
            t.task_number::TEXT as path
        FROM tasks t
        WHERE t.id = p_task_id 
            AND t.user_id = p_user_id
            AND t.deleted_at IS NULL
        
        UNION ALL
        
        -- Recursive case: find dependencies
        SELECT 
            dep_task.id,
            dep_task.task_number,
            dep_task.title,
            dep_task.status,
            dt.level + 1,
            dt.path || ' -> ' || dep_task.task_number::TEXT
        FROM dependency_tree dt
        JOIN task_dependencies td ON dt.task_id = td.task_id
        JOIN tasks dep_task ON td.depends_on_task_id = dep_task.id
        WHERE td.user_id = p_user_id
            AND dep_task.deleted_at IS NULL
            AND dt.level < 10  -- Prevent infinite recursion
    )
    SELECT * FROM dependency_tree
    ORDER BY level, task_number;
$$;

-- Function to migrate file-based task data
CREATE OR REPLACE FUNCTION migrate_file_tasks(
    p_user_id UUID,
    p_tasks_json JSONB
)
RETURNS TABLE (
    imported_tasks INTEGER,
    imported_subtasks INTEGER,
    imported_tags INTEGER,
    errors TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    task_json JSONB;
    subtask_json JSONB;
    tag_name TEXT;
    task_uuid UUID;
    tag_uuid UUID;
    task_count INTEGER := 0;
    subtask_count INTEGER := 0;
    tag_count INTEGER := 0;
    error_list TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Process each task from the JSON
    FOR task_json IN SELECT jsonb_array_elements(p_tasks_json->'tasks')
    LOOP
        BEGIN
            -- Insert task
            INSERT INTO tasks (
                user_id,
                task_number,
                title,
                description,
                status,
                priority,
                details,
                created_at,
                updated_at
            ) VALUES (
                p_user_id,
                (task_json->>'id')::INTEGER,
                task_json->>'title',
                task_json->>'description',
                COALESCE(task_json->>'status', 'pending'),
                COALESCE(task_json->>'priority', 'medium'),
                task_json,
                COALESCE((task_json->>'createdAt')::TIMESTAMPTZ, NOW()),
                COALESCE((task_json->>'updatedAt')::TIMESTAMPTZ, NOW())
            ) RETURNING id INTO task_uuid;
            
            task_count := task_count + 1;
            
            -- Process subtasks if they exist
            IF task_json ? 'subtasks' THEN
                FOR subtask_json IN SELECT jsonb_array_elements(task_json->'subtasks')
                LOOP
                    BEGIN
                        INSERT INTO subtasks (
                            user_id,
                            parent_task_id,
                            subtask_number,
                            title,
                            description,
                            status,
                            details
                        ) VALUES (
                            p_user_id,
                            task_uuid,
                            (subtask_json->>'id')::INTEGER,
                            subtask_json->>'title',
                            subtask_json->>'description',
                            COALESCE(subtask_json->>'status', 'pending'),
                            subtask_json
                        );
                        
                        subtask_count := subtask_count + 1;
                    EXCEPTION WHEN OTHERS THEN
                        error_list := array_append(error_list, 
                            'Subtask import error: ' || SQLERRM);
                    END;
                END LOOP;
            END IF;
            
            -- Process tags if they exist
            IF task_json ? 'tags' THEN
                FOR tag_name IN SELECT jsonb_array_elements_text(task_json->'tags')
                LOOP
                    BEGIN
                        -- Insert or get existing tag
                        INSERT INTO tags (user_id, name)
                        VALUES (p_user_id, tag_name)
                        ON CONFLICT (user_id, name) DO NOTHING
                        RETURNING id INTO tag_uuid;
                        
                        -- If tag already existed, get its ID
                        IF tag_uuid IS NULL THEN
                            SELECT id INTO tag_uuid 
                            FROM tags 
                            WHERE user_id = p_user_id AND name = tag_name;
                        ELSE
                            tag_count := tag_count + 1;
                        END IF;
                        
                        -- Link tag to task
                        INSERT INTO task_tags (user_id, task_id, tag_id)
                        VALUES (p_user_id, task_uuid, tag_uuid)
                        ON CONFLICT (task_id, tag_id) DO NOTHING;
                        
                    EXCEPTION WHEN OTHERS THEN
                        error_list := array_append(error_list, 
                            'Tag import error: ' || SQLERRM);
                    END;
                END LOOP;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            error_list := array_append(error_list, 
                'Task import error: ' || SQLERRM);
        END;
    END LOOP;
    
    RETURN QUERY SELECT task_count, subtask_count, tag_count, error_list;
END;
$$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(user_id, project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_user ON task_dependencies(task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_user ON task_dependencies(depends_on_task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_parent_user ON subtasks(parent_task_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_tags_task_user ON task_tags(task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_task_history_task_created ON task_history(task_id, created_at);

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_next_available_tasks TO authenticated;
GRANT EXECUTE ON FUNCTION get_blocked_tasks TO authenticated;
GRANT EXECUTE ON FUNCTION check_circular_dependency TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_completion_stats TO authenticated;
GRANT EXECUTE ON FUNCTION reorder_task_numbers TO authenticated;
GRANT EXECUTE ON FUNCTION get_task_dependency_tree TO authenticated;
GRANT EXECUTE ON FUNCTION migrate_file_tasks TO authenticated;