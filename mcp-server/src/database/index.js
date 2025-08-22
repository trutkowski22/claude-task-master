/**
 * Database Access Layer - Main Export
 * 
 * This module exports all database operations, utilities, and configurations
 * for use throughout the Task Master application.
 */

// Core configuration and connection
export { 
    supabase, 
    supabaseAdmin, 
    testConnection, 
    TABLES, 
    DB_CONFIG 
} from './config.js';

// Basic CRUD operations
export { 
    UserOps, 
    ProjectOps, 
    TaskOps, 
    SubtaskOps, 
    TagOps, 
    DependencyOps, 
    HistoryOps, 
    Utils,
    DatabaseError 
} from './operations.js';

// Advanced queries and analytics
export { 
    TaskQueries, 
    ProjectQueries, 
    TagQueries, 
    DependencyQueries, 
    BulkQueries, 
    MigrationQueries 
} from './queries.js';

// Database initialization and health checks
export { 
    initializeDatabase, 
    createUserProfile, 
    healthCheck 
} from './init.js';

/**
 * Convenience wrapper for common database operations
 * This provides a simplified API for the most common use cases
 */
export const db = {
    // User operations
    users: {
        create: async (userData) => {
            const { UserOps } = await import('./operations.js');
            return UserOps.create(userData);
        },
        getById: async (userId) => {
            const { UserOps } = await import('./operations.js');
            return UserOps.getById(userId);
        },
        update: async (userId, updates) => {
            const { UserOps } = await import('./operations.js');
            return UserOps.update(userId, updates);
        }
    },

    // Project operations
    projects: {
        create: async (userId, projectData) => {
            const { ProjectOps } = await import('./operations.js');
            return ProjectOps.create(userId, projectData);
        },
        getById: async (userId, projectId) => {
            const { ProjectOps } = await import('./operations.js');
            return ProjectOps.getById(userId, projectId);
        },
        list: async (userId) => {
            const { ProjectOps } = await import('./operations.js');
            return ProjectOps.list(userId);
        },
        update: async (userId, projectId, updates) => {
            const { ProjectOps } = await import('./operations.js');
            return ProjectOps.update(userId, projectId, updates);
        },
        delete: async (userId, projectId) => {
            const { ProjectOps } = await import('./operations.js');
            return ProjectOps.delete(userId, projectId);
        }
    },

    // Task operations
    tasks: {
        create: async (userId, taskData) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.create(userId, taskData);
        },
        getById: async (userId, taskId) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.getById(userId, taskId);
        },
        getByNumber: async (userId, taskNumber, projectId = null) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.getByNumber(userId, taskNumber, projectId);
        },
        list: async (userId, options = {}) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.list(userId, options);
        },
        update: async (userId, taskId, updates) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.update(userId, taskId, updates);
        },
        updateStatus: async (userId, taskId, status) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.updateStatus(userId, taskId, status);
        },
        delete: async (userId, taskId) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.delete(userId, taskId);
        },
        getNextNumber: async (userId, projectId = null) => {
            const { TaskOps } = await import('./operations.js');
            return TaskOps.getNextTaskNumber(userId, projectId);
        }
    },

    // Subtask operations
    subtasks: {
        create: async (userId, subtaskData) => {
            const { SubtaskOps } = await import('./operations.js');
            return SubtaskOps.create(userId, subtaskData);
        },
        getById: async (userId, subtaskId) => {
            const { SubtaskOps } = await import('./operations.js');
            return SubtaskOps.getById(userId, subtaskId);
        },
        listByTask: async (userId, taskId) => {
            const { SubtaskOps } = await import('./operations.js');
            return SubtaskOps.listByTask(userId, taskId);
        },
        update: async (userId, subtaskId, updates) => {
            const { SubtaskOps } = await import('./operations.js');
            return SubtaskOps.update(userId, subtaskId, updates);
        },
        delete: async (userId, subtaskId) => {
            const { SubtaskOps } = await import('./operations.js');
            return SubtaskOps.delete(userId, subtaskId);
        },
        clearByTask: async (userId, taskId) => {
            const { SubtaskOps } = await import('./operations.js');
            return SubtaskOps.clearByTask(userId, taskId);
        }
    },

    // Tag operations
    tags: {
        create: async (userId, tagData) => {
            const { TagOps } = await import('./operations.js');
            return TagOps.create(userId, tagData);
        },
        getByName: async (userId, tagName) => {
            const { TagOps } = await import('./operations.js');
            return TagOps.getByName(userId, tagName);
        },
        list: async (userId) => {
            const { TagOps } = await import('./operations.js');
            return TagOps.list(userId);
        },
        addToTask: async (userId, taskId, tagId) => {
            const { TagOps } = await import('./operations.js');
            return TagOps.addToTask(userId, taskId, tagId);
        },
        removeFromTask: async (userId, taskId, tagId) => {
            const { TagOps } = await import('./operations.js');
            return TagOps.removeFromTask(userId, taskId, tagId);
        },
        getTasksByTag: async (userId, tagId) => {
            const { TagOps } = await import('./operations.js');
            return TagOps.getTasksByTag(userId, tagId);
        }
    },

    // Dependency operations
    dependencies: {
        add: async (userId, taskId, dependsOnTaskId) => {
            const { DependencyOps } = await import('./operations.js');
            return DependencyOps.add(userId, taskId, dependsOnTaskId);
        },
        remove: async (userId, taskId, dependsOnTaskId) => {
            const { DependencyOps } = await import('./operations.js');
            return DependencyOps.remove(userId, taskId, dependsOnTaskId);
        },
        getByTask: async (userId, taskId) => {
            const { DependencyOps } = await import('./operations.js');
            return DependencyOps.getByTask(userId, taskId);
        },
        checkCircular: async (userId, taskId, dependsOnTaskId) => {
            const { DependencyOps } = await import('./operations.js');
            return DependencyOps.checkCircular(userId, taskId, dependsOnTaskId);
        }
    },

    // History/audit operations
    history: {
        log: async (userId, logData) => {
            const { HistoryOps } = await import('./operations.js');
            return HistoryOps.log(userId, logData);
        },
        getByTask: async (userId, taskId) => {
            const { HistoryOps } = await import('./operations.js');
            return HistoryOps.getByTask(userId, taskId);
        }
    },

    // Analytics and complex queries
    analytics: {
        getTaskStats: async (userId, projectId = null) => {
            const { TaskQueries } = await import('./queries.js');
            return TaskQueries.getTaskStats(userId, projectId);
        },
        getNextAvailableTasks: async (userId) => {
            const { TaskQueries } = await import('./queries.js');
            return TaskQueries.getNextAvailableTasks(userId);
        },
        searchTasks: async (userId, searchTerm, options = {}) => {
            const { TaskQueries } = await import('./queries.js');
            return TaskQueries.searchTasks(userId, searchTerm, options);
        }
    },

    // Utility functions
    utils: {
        getUserId: async (userContext = null) => {
            const { Utils } = await import('./operations.js');
            return Utils.getUserId(userContext);
        },
        validateRequired: async (data, requiredFields) => {
            const { Utils } = await import('./operations.js');
            return Utils.validateRequired(data, requiredFields);
        },
        transaction: async (callback) => {
            const { Utils } = await import('./operations.js');
            return Utils.transaction(callback);
        }
    }
};

/**
 * Database connection status
 */
export async function getDatabaseStatus() {
    try {
        const { testConnection } = await import('./config.js');
        const connection = await testConnection();
        return {
            connected: connection.success,
            message: connection.message,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            connected: false,
            message: error.message,
            timestamp: new Date().toISOString()
        };
    }
}