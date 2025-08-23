/**
 * generate-task-files-db.js
 * Database-powered implementation for generating individual task files
 *
 * This replaces the file-based generate-task-files.js with database operations
 */

import path from 'path';
import fs from 'fs';
import { db, DatabaseError } from '../../../mcp-server/src/database/index.js';
import { validateAndFixDependencies } from '../dependency-manager.js';
import { createLogWrapper } from '../../../mcp-server/src/tools/utils.js';

/**
 * Extract user ID from context
 * TODO: Replace with proper JWT token extraction in Phase 2
 */
function getUserId(context = {}) {
    // For now, return a default UUID or generate one for testing
    // In Phase 2, this will extract from JWT token
    if (context.userId && context.userId.length === 36) {
        return context.userId; // Already a UUID
    }

    // Return a default test UUID for migration testing
    return '00000000-0000-0000-0000-000000000001';
}

/**
 * Format dependencies with status information
 * @param {Array} dependencies - Array of dependency task IDs
 * @param {Array} allTasks - Array of all tasks
 * @param {boolean} includeStatus - Whether to include status in formatting
 * @returns {string} Formatted dependencies string
 */
function formatDependenciesWithStatus(dependencies, allTasks, includeStatus = true) {
    if (!dependencies || dependencies.length === 0) {
        return 'None';
    }

    const taskMap = new Map(allTasks.map(task => [task.task_number, task]));

    return dependencies.map(depId => {
        const task = taskMap.get(depId);
        if (!task) {
            return `#${depId} (not found)`;
        }

        if (includeStatus) {
            return `#${depId} [${task.status}]`;
        } else {
            return `#${depId}`;
        }
    }).join(', ');
}

/**
 * Generate task files from database for a specific tag
 * @param {string} userId - User ID for multi-tenancy
 * @param {string} projectId - Project ID (optional)
 * @param {string} tag - Tag name to generate files for
 * @param {string} outputDir - Output directory for task files
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Result object
 */
async function generateTaskFilesDb(userId, projectId = null, tag, outputDir, context = {}) {
    const { mcpLog } = context;
    const isMcpMode = !!mcpLog;

    // Create a consistent logFn object regardless of context
    const logFn = isMcpMode
        ? mcpLog
        : {
            info: (msg) => console.log(`[INFO] ${msg}`),
            warn: (msg) => console.warn(`[WARN] ${msg}`),
            error: (msg) => console.error(`[ERROR] ${msg}`),
            success: (msg) => console.log(`[SUCCESS] ${msg}`)
        };

    try {
        // Validate user ID
        if (!userId) {
            throw new DatabaseError('User ID is required for task file generation');
        }

        // Validate tag
        if (!tag) {
            throw new DatabaseError('Tag is required for task file generation');
        }

        // Validate output directory
        if (!outputDir) {
            throw new DatabaseError('Output directory is required for task file generation');
        }

        // Create the output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        logFn.info(`Preparing to regenerate task files for tag '${tag}' from database`);

        // Get all tasks for the user (across all tags since tags are separate)
        const allTasks = await db.tasks.list(userId, {
            projectId,
            // Get all tasks regardless of status for comprehensive processing
        });

        if (allTasks.length === 0) {
            logFn.warn(`No tasks found for user ${userId}`);
            return {
                success: true,
                count: 0,
                directory: outputDir,
                message: 'No tasks found to generate files for'
            };
        }

        // Get tasks by tag - since tags are stored separately, we need to get tag associations
        let tagObj;
        try {
            tagObj = await db.tags.getByName(userId, tag);
        } catch (error) {
            throw new DatabaseError(`Tag '${tag}' not found for user ${userId}`);
        }

        const taggedTasks = await db.tags.getTasksByTag(userId, tagObj.id);

        if (taggedTasks.length === 0) {
            logFn.warn(`No tasks found for tag '${tag}'`);
            return {
                success: true,
                count: 0,
                directory: outputDir,
                message: `No tasks found for tag '${tag}'`
            };
        }

        logFn.info(`Found ${taggedTasks.length} tasks for tag '${tag}'`);

        // Validate dependencies using the database structure
        // Note: The original validateAndFixDependencies function expects file-based data
        // We'll need to adapt this or create a new database-based validation
        try {
            // For now, we'll skip the dependency validation since it's file-based
            // In a future iteration, we should create a database-based dependency validator
            logFn.info('Dependency validation skipped - using database structure');
        } catch (depError) {
            logFn.warn(`Dependency validation warning: ${depError.message}`);
        }

        const tasksForGeneration = taggedTasks;
        const validTaskIds = tasksForGeneration.map(task => task.task_number);

        // Cleanup orphaned task files
        logFn.info('Checking for orphaned task files to clean up...');
        try {
            const files = fs.readdirSync(outputDir);

            // Tag-aware file patterns: master -> task_001.txt, other tags -> task_001_tagname.txt
            const masterFilePattern = /^task_(\d+)\.txt$/;
            const taggedFilePattern = new RegExp(`^task_(\\d+)_${tag}\\.txt$`);

            const orphanedFiles = files.filter((file) => {
                let match = null;
                let fileTaskId = null;

                // Check if file belongs to current tag
                if (tag === 'master') {
                    match = file.match(masterFilePattern);
                    if (match) {
                        fileTaskId = parseInt(match[1], 10);
                        // Only clean up master files when processing master tag
                        return !validTaskIds.includes(fileTaskId);
                    }
                } else {
                    match = file.match(taggedFilePattern);
                    if (match) {
                        fileTaskId = parseInt(match[1], 10);
                        // Only clean up files for the current tag
                        return !validTaskIds.includes(fileTaskId);
                    }
                }
                return false;
            });

            if (orphanedFiles.length > 0) {
                logFn.info(`Found ${orphanedFiles.length} orphaned task files to remove for tag '${tag}'`);
                orphanedFiles.forEach((file) => {
                    const filePath = path.join(outputDir, file);
                    fs.unlinkSync(filePath);
                    logFn.info(`Removed orphaned file: ${file}`);
                });
            } else {
                logFn.info('No orphaned task files found.');
            }
        } catch (err) {
            logFn.warn(`Error cleaning up orphaned task files: ${err.message}`);
        }

        // Generate task files for the target tag
        logFn.info(`Generating individual task files for tag '${tag}'...`);

        for (const task of tasksForGeneration) {
            // Tag-aware file naming: master -> task_001.txt, other tags -> task_001_tagname.txt
            const taskFileName = tag === 'master'
                ? `task_${task.task_number.toString().padStart(3, '0')}.txt`
                : `task_${task.task_number.toString().padStart(3, '0')}_${tag}.txt`;

            const taskPath = path.join(outputDir, taskFileName);

            // Get subtasks for this task
            const subtasks = await db.subtasks.listByTask(userId, task.id);

            // Get dependencies for this task
            const dependencies = await db.dependencies.getByTask(userId, task.id);
            const dependencyTaskNumbers = dependencies.map(dep => {
                // Find the task number for each dependency
                const depTask = allTasks.find(t => t.id === dep.depends_on_task_id);
                return depTask ? depTask.task_number : null;
            }).filter(Boolean);

            let content = `# Task ID: ${task.task_number}\n`;
            content += `# Title: ${task.title}\n`;
            content += `# Status: ${task.status || 'pending'}\n`;

            if (dependencyTaskNumbers.length > 0) {
                content += `# Dependencies: ${formatDependenciesWithStatus(dependencyTaskNumbers, allTasks, true)}\n`;
            } else {
                content += '# Dependencies: None\n';
            }

            content += `# Priority: ${task.priority || 'medium'}\n`;
            content += `# Description: ${task.description || ''}\n`;

            // Add implementation details if available
            const implementation = task.details?.implementation || '';
            if (implementation) {
                content += '# Details:\n';
                content += implementation.split('\n').map(line => line || '').join('\n');
                content += '\n\n';
            }

            // Add test strategy if available
            const testStrategy = task.details?.testStrategy || '';
            if (testStrategy) {
                content += '# Test Strategy:\n';
                content += testStrategy.split('\n').map(line => line || '').join('\n');
                content += '\n';
            }

            if (subtasks && subtasks.length > 0) {
                content += '\n# Subtasks:\n';
                for (const subtask of subtasks) {
                    content += `## ${subtask.subtask_number}. ${subtask.title} [${subtask.status || 'pending'}]\n`;

                    // Get subtask dependencies
                    const subtaskDeps = await db.dependencies.getByTask(userId, subtask.id);
                    if (subtaskDeps.length > 0) {
                        const subtaskDepNumbers = subtaskDeps.map(dep => {
                            const depTask = allTasks.find(t => t.id === dep.depends_on_task_id);
                            return depTask ? `${task.task_number}.${depTask.task_number}` : null;
                        }).filter(Boolean);

                        if (subtaskDepNumbers.length > 0) {
                            content += `### Dependencies: ${subtaskDepNumbers.join(', ')}\n`;
                        } else {
                            content += '### Dependencies: None\n';
                        }
                    } else {
                        content += '### Dependencies: None\n';
                    }

                    content += `### Description: ${subtask.description || ''}\n`;

                    // Add subtask details if available
                    const subtaskDetails = subtask.details?.implementation || '';
                    if (subtaskDetails) {
                        content += '### Details:\n';
                        content += subtaskDetails.split('\n').map(line => line || '').join('\n');
                        content += '\n\n';
                    } else {
                        content += '\n';
                    }
                }
            }

            fs.writeFileSync(taskPath, content);
            logFn.info(`Generated file: ${taskFileName}`);
        }

        logFn.success(`All ${tasksForGeneration.length} tasks for tag '${tag}' have been generated into '${outputDir}'.`);

        return {
            success: true,
            count: tasksForGeneration.length,
            directory: outputDir,
            tag: tag,
            message: `Successfully generated ${tasksForGeneration.length} task files for tag '${tag}'`
        };

    } catch (error) {
        logFn.error(`Error generating task files: ${error.message}`);

        throw new DatabaseError(`Failed to generate task files: ${error.message}`, error.code, {
            userId,
            projectId,
            tag,
            outputDir
        });
    }
}

/**
 * Direct function wrapper for generating task files with database operations
 *
 * This is the main entry point that replaces the file-based generateTaskFiles function
 */
export async function generateTaskFilesDirect(args, log, context = {}) {
    const {
        tag,
        outputDir,
        projectId // New parameter for multi-project support
    } = args;

    const { session } = context;

    // Create logger wrapper
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context (will be from JWT in Phase 2)
        const userId = getUserId(context);

        // Validate required parameters
        if (!tag) {
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Tag is required for task file generation'
                }
            };
        }

        if (!outputDir) {
            return {
                success: false,
                error: {
                    code: 'MISSING_PARAMETER',
                    message: 'Output directory is required for task file generation'
                }
            };
        }

        // Call the database-powered task file generation
        const result = await generateTaskFilesDb(
            userId,
            projectId,
            tag,
            outputDir,
            {
                session,
                mcpLog
            }
        );

        return {
            success: true,
            data: result
        };

    } catch (error) {
        log.error(`Error in generateTaskFilesDirect: ${error.message}`);

        return {
            success: false,
            error: {
                code: error.code || 'GENERATE_TASK_FILES_ERROR',
                message: error.message
            }
        };
    }
}