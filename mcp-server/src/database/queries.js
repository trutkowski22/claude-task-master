/**
 * Advanced Query Builder and Complex Database Operations
 * 
 * This module provides advanced querying capabilities and complex operations
 * that require joins, aggregations, or sophisticated filtering.
 */

import { supabaseAdmin, TABLES } from './config.js';
import { handleDbResponse } from './operations.js';

/**
 * COMPLEX TASK QUERIES
 */
export const TaskQueries = {
    /**
     * Get tasks with subtasks count
     */
    async getTasksWithSubtaskCount(userId, options = {}) {
        let query = supabaseAdmin
            .from(TABLES.TASKS)
            .select(`
                *,
                subtasks_count:subtasks(count)
            `)
            .eq('user_id', userId)
            .is('deleted_at', null);

        // Apply filters
        if (options.status) {
            query = query.eq('status', options.status);
        }
        if (options.projectId) {
            query = query.eq('project_id', options.projectId);
        }

        const response = await query.order('task_number', { ascending: true });
        return handleDbResponse(response, 'Get tasks with subtask count');
    },

    /**
     * Get tasks with their tags
     */
    async getTasksWithTags(userId, options = {}) {
        let query = supabaseAdmin
            .from(TABLES.TASKS)
            .select(`
                *,
                task_tags:task_tags(
                    tag:tags(*)
                )
            `)
            .eq('user_id', userId)
            .is('deleted_at', null);

        if (options.status) {
            query = query.eq('status', options.status);
        }

        const response = await query.order('task_number', { ascending: true });
        return handleDbResponse(response, 'Get tasks with tags');
    },

    /**
     * Get tasks with dependencies
     */
    async getTasksWithDependencies(userId) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .select(`
                *,
                dependencies:task_dependencies!task_id(
                    depends_on_task:tasks!depends_on_task_id(id, task_number, title, status)
                ),
                dependents:task_dependencies!depends_on_task_id(
                    dependent_task:tasks!task_id(id, task_number, title, status)
                )
            `)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('task_number', { ascending: true });

        return handleDbResponse(response, 'Get tasks with dependencies');
    },

    /**
     * Get next available tasks (no pending dependencies)
     */
    async getNextAvailableTasks(userId) {
        // Get tasks that have no dependencies OR all dependencies are completed
        const response = await supabaseAdmin.rpc('get_next_available_tasks', {
            p_user_id: userId
        });

        return handleDbResponse(response, 'Get next available tasks');
    },

    /**
     * Search tasks by title/description
     */
    async searchTasks(userId, searchTerm, options = {}) {
        let query = supabaseAdmin
            .from(TABLES.TASKS)
            .select('*')
            .eq('user_id', userId)
            .is('deleted_at', null)
            .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);

        if (options.status) {
            query = query.eq('status', options.status);
        }

        const response = await query
            .order('task_number', { ascending: true })
            .limit(options.limit || 50);

        return handleDbResponse(response, 'Search tasks');
    },

    /**
     * Get task statistics
     */
    async getTaskStats(userId, projectId = null) {
        let baseQuery = supabaseAdmin
            .from(TABLES.TASKS)
            .select('status')
            .eq('user_id', userId)
            .is('deleted_at', null);

        if (projectId) {
            baseQuery = baseQuery.eq('project_id', projectId);
        }

        const response = await baseQuery;
        const tasks = handleDbResponse(response, 'Get task stats');

        // Calculate statistics
        const stats = {
            total: tasks.length,
            pending: tasks.filter(t => t.status === 'pending').length,
            in_progress: tasks.filter(t => t.status === 'in-progress').length,
            review: tasks.filter(t => t.status === 'review').length,
            done: tasks.filter(t => t.status === 'done').length,
            cancelled: tasks.filter(t => t.status === 'cancelled').length,
            deferred: tasks.filter(t => t.status === 'deferred').length
        };

        stats.completion_rate = stats.total > 0 ? (stats.done / stats.total * 100).toFixed(1) : 0;
        stats.active = stats.pending + stats.in_progress + stats.review;

        return stats;
    }
};

/**
 * PROJECT ANALYTICS
 */
export const ProjectQueries = {
    /**
     * Get project with task summary
     */
    async getProjectWithTaskSummary(userId, projectId) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .select(`
                *,
                tasks:tasks(count),
                completed_tasks:tasks!inner(count).eq(status, 'done'),
                pending_tasks:tasks!inner(count).eq(status, 'pending'),
                in_progress_tasks:tasks!inner(count).eq(status, 'in-progress')
            `)
            .eq('id', projectId)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .single();

        return handleDbResponse(response, 'Get project with task summary');
    },

    /**
     * Get all projects with task counts
     */
    async getProjectsWithTaskCounts(userId) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .select(`
                *,
                task_count:tasks(count),
                completed_tasks:tasks!inner(count).eq(status, 'done')
            `)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        return handleDbResponse(response, 'Get projects with task counts');
    }
};

/**
 * TAG ANALYTICS
 */
export const TagQueries = {
    /**
     * Get tags with task counts
     */
    async getTagsWithTaskCounts(userId) {
        const response = await supabaseAdmin
            .from(TABLES.TAGS)
            .select(`
                *,
                task_count:task_tags(count),
                active_task_count:task_tags!inner(
                    count,
                    task:tasks!inner(status).neq(status, 'done').neq(status, 'cancelled')
                )
            `)
            .eq('user_id', userId)
            .order('name', { ascending: true });

        return handleDbResponse(response, 'Get tags with task counts');
    },

    /**
     * Get tasks by tag name
     */
    async getTasksByTagName(userId, tagName) {
        const response = await supabaseAdmin
            .from('task_tags')
            .select(`
                task:tasks!inner(*)
            `)
            .eq('user_id', userId)
            .eq('tag.name', tagName)
            .eq('tasks.deleted_at', null);

        return handleDbResponse(response, 'Get tasks by tag name');
    }
};

/**
 * DEPENDENCY ANALYSIS
 */
export const DependencyQueries = {
    /**
     * Get dependency graph for visualization
     */
    async getDependencyGraph(userId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_DEPENDENCIES)
            .select(`
                task_id,
                depends_on_task_id,
                task:tasks!task_id(id, task_number, title, status),
                depends_on:tasks!depends_on_task_id(id, task_number, title, status)
            `)
            .eq('user_id', userId);

        return handleDbResponse(response, 'Get dependency graph');
    },

    /**
     * Find circular dependencies
     */
    async findCircularDependencies(userId) {
        // This would require a recursive query or stored procedure
        // For now, return empty array - implement proper cycle detection later
        return [];
    },

    /**
     * Get blocked tasks (tasks with incomplete dependencies)
     */
    async getBlockedTasks(userId) {
        const response = await supabaseAdmin.rpc('get_blocked_tasks', {
            p_user_id: userId
        });

        return handleDbResponse(response, 'Get blocked tasks');
    }
};

/**
 * BULK OPERATIONS
 */
export const BulkQueries = {
    /**
     * Bulk update task status
     */
    async updateTaskStatuses(userId, taskIds, status) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .update({ 
                status,
                updated_at: new Date().toISOString(),
                ...(status === 'done' ? { completed_at: new Date().toISOString() } : {})
            })
            .eq('user_id', userId)
            .in('id', taskIds)
            .select();

        return handleDbResponse(response, 'Bulk update task statuses');
    },

    /**
     * Bulk delete tasks
     */
    async deleteTasks(userId, taskIds) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .update({ deleted_at: new Date().toISOString() })
            .eq('user_id', userId)
            .in('id', taskIds)
            .select();

        return handleDbResponse(response, 'Bulk delete tasks');
    },

    /**
     * Bulk move tasks to project
     */
    async moveTasksToProject(userId, taskIds, projectId) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .update({ 
                project_id: projectId,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .in('id', taskIds)
            .select();

        return handleDbResponse(response, 'Bulk move tasks to project');
    }
};

/**
 * MIGRATION HELPERS
 */
export const MigrationQueries = {
    /**
     * Import tasks from JSON (for migration from file system)
     */
    async importTasksFromJson(userId, tasksData) {
        const tasks = [];
        const subtasks = [];
        const tags = [];
        const taskTags = [];
        const dependencies = [];

        // Process the JSON data and convert to database format
        for (const task of tasksData.tasks || []) {
            const taskRecord = {
                user_id: userId,
                task_number: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                details: {
                    originalData: task // Preserve original structure
                },
                created_at: task.createdAt || new Date().toISOString(),
                updated_at: task.updatedAt || new Date().toISOString()
            };

            tasks.push(taskRecord);

            // Process subtasks
            if (task.subtasks) {
                for (const subtask of task.subtasks) {
                    subtasks.push({
                        user_id: userId,
                        parent_task_id: task.id, // Will need to map this to actual UUIDs
                        subtask_number: subtask.id,
                        title: subtask.title,
                        description: subtask.description,
                        status: subtask.status,
                        details: { originalData: subtask }
                    });
                }
            }

            // Process tags
            if (task.tags) {
                for (const tagName of task.tags) {
                    if (!tags.find(t => t.name === tagName)) {
                        tags.push({
                            user_id: userId,
                            name: tagName
                        });
                    }
                }
            }
        }

        // Insert in correct order (tasks first, then subtasks, etc.)
        const insertedTasks = await supabaseAdmin.from(TABLES.TASKS).insert(tasks).select();
        const insertedSubtasks = await supabaseAdmin.from(TABLES.SUBTASKS).insert(subtasks).select();
        const insertedTags = await supabaseAdmin.from(TABLES.TAGS).insert(tags).select();

        return {
            tasks: handleDbResponse(insertedTasks, 'Import tasks'),
            subtasks: handleDbResponse(insertedSubtasks, 'Import subtasks'),
            tags: handleDbResponse(insertedTags, 'Import tags')
        };
    }
};