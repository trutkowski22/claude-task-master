/**
 * Database Access Layer - Common Operations
 * 
 * This module provides reusable database operations for all core functions.
 * It abstracts away Supabase specifics and provides a clean API for task management.
 */

import { supabase, supabaseAdmin, TABLES } from './config.js';

/**
 * Error handling wrapper for database operations
 */
class DatabaseError extends Error {
    constructor(message, code = null, details = null) {
        super(message);
        this.name = 'DatabaseError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Wrap database operations with consistent error handling
 */
export function handleDbResponse(response, operation = 'database operation') {
    const { data, error } = response;
    
    if (error) {
        throw new DatabaseError(
            `${operation} failed: ${error.message}`,
            error.code,
            error.details
        );
    }
    
    return data;
}

/**
 * Get authenticated user ID from context
 * For now, we'll use service role until authentication is implemented
 */
function getUserId(userContext = null) {
    // TODO: Extract from JWT token in Phase 2
    // For now, return a default user ID or from context
    return userContext?.userId || null;
}

/**
 * USER OPERATIONS
 */
export const UserOps = {
    /**
     * Create a new user profile
     */
    async create(userData) {
        const response = await supabaseAdmin
            .from(TABLES.USERS)
            .insert({
                id: userData.id,
                email: userData.email,
                display_name: userData.displayName || userData.email.split('@')[0],
                settings: userData.settings || {}
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Create user');
    },

    /**
     * Get user by ID
     */
    async getById(userId) {
        const response = await supabaseAdmin
            .from(TABLES.USERS)
            .select('*')
            .eq('id', userId)
            .single();
            
        return handleDbResponse(response, 'Get user');
    },

    /**
     * Update user profile
     */
    async update(userId, updates) {
        const response = await supabaseAdmin
            .from(TABLES.USERS)
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Update user');
    }
};

/**
 * PROJECT OPERATIONS
 */
export const ProjectOps = {
    /**
     * Create a new project
     */
    async create(userId, projectData) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .insert({
                user_id: userId,
                name: projectData.name,
                description: projectData.description,
                settings: projectData.settings || {},
                metadata: projectData.metadata || {}
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Create project');
    },

    /**
     * Get project by ID
     */
    async getById(userId, projectId) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .select('*')
            .eq('id', projectId)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .single();
            
        return handleDbResponse(response, 'Get project');
    },

    /**
     * List user's projects
     */
    async list(userId) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .select('*')
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
            
        return handleDbResponse(response, 'List projects');
    },

    /**
     * Update project
     */
    async update(userId, projectId, updates) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', projectId)
            .eq('user_id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Update project');
    },

    /**
     * Soft delete project
     */
    async delete(userId, projectId) {
        const response = await supabaseAdmin
            .from(TABLES.PROJECTS)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', projectId)
            .eq('user_id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Delete project');
    }
};

/**
 * TASK OPERATIONS
 */
export const TaskOps = {
    /**
     * Create a new task
     */
    async create(userId, taskData) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .insert({
                user_id: userId,
                project_id: taskData.projectId,
                task_number: taskData.taskNumber, // Will be auto-assigned if null
                title: taskData.title,
                description: taskData.description,
                status: taskData.status || 'pending',
                priority: taskData.priority || 'medium',
                details: taskData.details || {}
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Create task');
    },

    /**
     * Get task by ID
     */
    async getById(userId, taskId) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .select('*')
            .eq('id', taskId)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .single();
            
        return handleDbResponse(response, 'Get task');
    },

    /**
     * Get task by number
     */
    async getByNumber(userId, taskNumber, projectId = null) {
        let query = supabaseAdmin
            .from(TABLES.TASKS)
            .select('*')
            .eq('user_id', userId)
            .eq('task_number', taskNumber)
            .is('deleted_at', null);

        if (projectId) {
            query = query.eq('project_id', projectId);
        } else {
            query = query.is('project_id', null);
        }

        const response = await query.single();
        return handleDbResponse(response, 'Get task by number');
    },

    /**
     * List tasks with filtering and pagination
     */
    async list(userId, options = {}) {
        let query = supabaseAdmin
            .from(TABLES.TASKS)
            .select('*')
            .eq('user_id', userId)
            .is('deleted_at', null);

        // Apply filters
        if (options.projectId) {
            query = query.eq('project_id', options.projectId);
        }
        if (options.status) {
            if (Array.isArray(options.status)) {
                query = query.in('status', options.status);
            } else {
                query = query.eq('status', options.status);
            }
        }
        if (options.priority) {
            query = query.eq('priority', options.priority);
        }

        // Apply sorting
        const sortBy = options.sortBy || 'task_number';
        const sortOrder = options.sortOrder || 'asc';
        query = query.order(sortBy, { ascending: sortOrder === 'asc' });

        // Apply pagination
        if (options.limit) {
            query = query.limit(options.limit);
        }
        if (options.offset) {
            query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
        }

        const response = await query;
        return handleDbResponse(response, 'List tasks');
    },

    /**
     * Update task
     */
    async update(userId, taskId, updates) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
                ...(updates.status === 'done' && !updates.completed_at 
                    ? { completed_at: new Date().toISOString() } 
                    : {})
            })
            .eq('id', taskId)
            .eq('user_id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Update task');
    },

    /**
     * Update task status
     */
    async updateStatus(userId, taskId, status) {
        return this.update(userId, taskId, { 
            status,
            ...(status === 'done' ? { completed_at: new Date().toISOString() } : {})
        });
    },

    /**
     * Soft delete task
     */
    async delete(userId, taskId) {
        const response = await supabaseAdmin
            .from(TABLES.TASKS)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', taskId)
            .eq('user_id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Delete task');
    },

    /**
     * Get next available task number
     */
    async getNextTaskNumber(userId, projectId = null) {
        let query = supabaseAdmin
            .from(TABLES.TASKS)
            .select('task_number')
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('task_number', { ascending: false })
            .limit(1);

        if (projectId) {
            query = query.eq('project_id', projectId);
        } else {
            query = query.is('project_id', null);
        }

        const response = await query;
        const data = handleDbResponse(response, 'Get next task number');
        
        return data.length > 0 ? data[0].task_number + 1 : 1;
    }
};

/**
 * SUBTASK OPERATIONS
 */
export const SubtaskOps = {
    /**
     * Create a new subtask
     */
    async create(userId, subtaskData) {
        const response = await supabaseAdmin
            .from(TABLES.SUBTASKS)
            .insert({
                user_id: userId,
                parent_task_id: subtaskData.parentTaskId,
                subtask_number: subtaskData.subtaskNumber, // Will be auto-assigned if null
                title: subtaskData.title,
                description: subtaskData.description,
                status: subtaskData.status || 'pending',
                details: subtaskData.details || {}
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Create subtask');
    },

    /**
     * Get subtask by ID
     */
    async getById(userId, subtaskId) {
        const response = await supabaseAdmin
            .from(TABLES.SUBTASKS)
            .select('*')
            .eq('id', subtaskId)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .single();
            
        return handleDbResponse(response, 'Get subtask');
    },

    /**
     * List subtasks for a task
     */
    async listByTask(userId, taskId) {
        const response = await supabaseAdmin
            .from(TABLES.SUBTASKS)
            .select('*')
            .eq('user_id', userId)
            .eq('parent_task_id', taskId)
            .is('deleted_at', null)
            .order('subtask_number', { ascending: true });
            
        return handleDbResponse(response, 'List subtasks');
    },

    /**
     * Update subtask
     */
    async update(userId, subtaskId, updates) {
        const response = await supabaseAdmin
            .from(TABLES.SUBTASKS)
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
                ...(updates.status === 'done' && !updates.completed_at 
                    ? { completed_at: new Date().toISOString() } 
                    : {})
            })
            .eq('id', subtaskId)
            .eq('user_id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Update subtask');
    },

    /**
     * Soft delete subtask
     */
    async delete(userId, subtaskId) {
        const response = await supabaseAdmin
            .from(TABLES.SUBTASKS)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', subtaskId)
            .eq('user_id', userId)
            .select()
            .single();
            
        return handleDbResponse(response, 'Delete subtask');
    },

    /**
     * Clear all subtasks for a task
     */
    async clearByTask(userId, taskId) {
        const response = await supabaseAdmin
            .from(TABLES.SUBTASKS)
            .update({ deleted_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('parent_task_id', taskId)
            .is('deleted_at', null);
            
        return handleDbResponse(response, 'Clear subtasks');
    }
};

/**
 * TAG OPERATIONS
 */
export const TagOps = {
    /**
     * Create a new tag
     */
    async create(userId, tagData) {
        const response = await supabaseAdmin
            .from(TABLES.TAGS)
            .insert({
                user_id: userId,
                name: tagData.name,
                description: tagData.description,
                color: tagData.color
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Create tag');
    },

    /**
     * Get tag by name
     */
    async getByName(userId, tagName) {
        const response = await supabaseAdmin
            .from(TABLES.TAGS)
            .select('*')
            .eq('user_id', userId)
            .eq('name', tagName)
            .single();
            
        return handleDbResponse(response, 'Get tag by name');
    },

    /**
     * List all tags for user
     */
    async list(userId) {
        const response = await supabaseAdmin
            .from(TABLES.TAGS)
            .select('*')
            .eq('user_id', userId)
            .order('name', { ascending: true });
            
        return handleDbResponse(response, 'List tags');
    },

    /**
     * Add tag to task
     */
    async addToTask(userId, taskId, tagId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_TAGS)
            .insert({
                user_id: userId,
                task_id: taskId,
                tag_id: tagId
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Add tag to task');
    },

    /**
     * Remove tag from task
     */
    async removeFromTask(userId, taskId, tagId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_TAGS)
            .delete()
            .eq('user_id', userId)
            .eq('task_id', taskId)
            .eq('tag_id', tagId);
            
        return handleDbResponse(response, 'Remove tag from task');
    },

    /**
     * Get tasks by tag
     */
    async getTasksByTag(userId, tagId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_TAGS)
            .select(`
                task_id,
                tasks:task_id (*)
            `)
            .eq('user_id', userId)
            .eq('tag_id', tagId);
            
        return handleDbResponse(response, 'Get tasks by tag');
    }
};

/**
 * DEPENDENCY OPERATIONS
 */
export const DependencyOps = {
    /**
     * Add dependency between tasks
     */
    async add(userId, taskId, dependsOnTaskId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_DEPENDENCIES)
            .insert({
                user_id: userId,
                task_id: taskId,
                depends_on_task_id: dependsOnTaskId
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Add dependency');
    },

    /**
     * Remove dependency
     */
    async remove(userId, taskId, dependsOnTaskId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_DEPENDENCIES)
            .delete()
            .eq('user_id', userId)
            .eq('task_id', taskId)
            .eq('depends_on_task_id', dependsOnTaskId);
            
        return handleDbResponse(response, 'Remove dependency');
    },

    /**
     * Get task dependencies
     */
    async getByTask(userId, taskId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_DEPENDENCIES)
            .select(`
                depends_on_task_id,
                dependency_task:depends_on_task_id (*)
            `)
            .eq('user_id', userId)
            .eq('task_id', taskId);
            
        return handleDbResponse(response, 'Get task dependencies');
    },

    /**
     * Check for circular dependencies
     */
    async checkCircular(userId, taskId, dependsOnTaskId) {
        // Implementation would check if adding this dependency creates a cycle
        // For now, return false (no circular dependency)
        return false;
    }
};

/**
 * HISTORY/AUDIT OPERATIONS
 */
export const HistoryOps = {
    /**
     * Log a change to task/subtask
     */
    async log(userId, logData) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_HISTORY)
            .insert({
                user_id: userId,
                task_id: logData.taskId,
                subtask_id: logData.subtaskId,
                action: logData.action,
                field_name: logData.fieldName,
                old_value: logData.oldValue,
                new_value: logData.newValue,
                change_summary: logData.changeSummary
            })
            .select()
            .single();
            
        return handleDbResponse(response, 'Log history');
    },

    /**
     * Get history for a task
     */
    async getByTask(userId, taskId) {
        const response = await supabaseAdmin
            .from(TABLES.TASK_HISTORY)
            .select('*')
            .eq('user_id', userId)
            .eq('task_id', taskId)
            .order('created_at', { ascending: false });
            
        return handleDbResponse(response, 'Get task history');
    }
};

/**
 * UTILITY FUNCTIONS
 */
export const Utils = {
    /**
     * Get user context from request/session
     */
    getUserId,

    /**
     * Handle database errors consistently
     */
    handleDbResponse,

    /**
     * Database transaction wrapper
     */
    async transaction(callback) {
        // Supabase doesn't expose transactions directly through the client
        // For now, we'll execute the callback directly
        // TODO: Implement proper transaction handling when needed
        return await callback();
    },

    /**
     * Validate required fields
     */
    validateRequired(data, requiredFields) {
        const missing = requiredFields.filter(field => !data[field]);
        if (missing.length > 0) {
            throw new DatabaseError(`Missing required fields: ${missing.join(', ')}`);
        }
    }
};

// Export the DatabaseError class for external use
export { DatabaseError };