/**
 * initialize-project-db.js
 * Database-powered implementation for project initialization
 * 
 * This replaces the file-based initialize-project.js with database operations
 */

import { db, DatabaseError } from '../../database/index.js';
import { createLogWrapper } from '../../tools/utils.js';
import fs from 'fs';
import path from 'path';

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
 * Database-powered project initialization function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} options - Initialization options
 * @param {boolean} options.addAliases - Add shell aliases
 * @param {boolean} options.initGit - Initialize Git repository
 * @param {boolean} options.storeTasksInGit - Store tasks in Git
 * @param {boolean} options.skipInstall - Skip installing dependencies
 * @param {boolean} options.yes - Skip prompts and use defaults
 * @param {Array} options.rules - Rule profiles to include
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Project initialization result
 */
async function initializeProjectDb(
    userId,
    options = {},
    projectId = null,
    context = {}
) {
    const { mcpLog, projectRoot } = context;
    const isMCP = !!mcpLog;

    // Create a consistent logFn object regardless of context
    const logFn = isMCP
        ? mcpLog
        : {
            info: (msg) => console.log(`[INFO] ${msg}`),
            warn: (msg) => console.warn(`[WARN] ${msg}`),
            error: (msg) => console.error(`[ERROR] ${msg}`)
        };

    try {
        // Validate user ID
        if (!userId) {
            throw new DatabaseError('User ID is required for project initialization');
        }

        const {
            addAliases = false,
            initGit = false,
            storeTasksInGit = false,
            skipInstall = false,
            yes = false,
            rules = ['cursor']
        } = options;

        const resolvedProjectRoot = projectRoot || process.cwd();

        logFn.info(`Initializing project in database for path: ${resolvedProjectRoot}`);

        // Check if project already exists in database
        let existingProject;
        try {
            // For now, we'll use a simple project lookup based on path
            // In Phase 2, this would be more sophisticated with proper project management
            existingProject = await db.projects.getByPath(userId, resolvedProjectRoot);
        } catch (error) {
            // Project doesn't exist, which is expected for new initialization
            logFn.info('No existing project found - proceeding with new project creation');
        }

        if (existingProject) {
            logFn.warn(`Project already exists in database with ID: ${existingProject.id}`);
            return {
                success: true,
                project: existingProject,
                message: 'Project already initialized in database',
                alreadyExists: true
            };
        }

        // Create project directories (this still needs file system operations)
        const taskmasterDir = path.join(resolvedProjectRoot, '.taskmaster');
        const tasksDir = path.join(taskmasterDir, 'tasks');
        const docsDir = path.join(taskmasterDir, 'docs');
        const templatesDir = path.join(taskmasterDir, 'templates');
        
        // Create directories if they don't exist
        [taskmasterDir, tasksDir, docsDir, templatesDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logFn.info(`Created directory: ${dir}`);
            }
        });

        // Create initial configuration
        const projectConfig = {
            name: path.basename(resolvedProjectRoot),
            path: resolvedProjectRoot,
            settings: {
                defaultTag: 'master',
                logLevel: 'info',
                rules: rules || ['cursor'],
                addAliases,
                initGit,
                storeTasksInGit,
                autoSave: true,
                backupEnabled: true
            },
            metadata: {
                createdAt: new Date().toISOString(),
                version: '2.0.0-db',
                initialized: true
            }
        };

        // Create project in database
        const newProject = await db.projects.create(userId, projectConfig);
        logFn.info(`Created project in database with ID: ${newProject.id}`);

        // Create initial master tag if it doesn't exist
        try {
            let masterTag = await db.tags.getByName(userId, 'master');
            if (!masterTag) {
                masterTag = await db.tags.create(userId, {
                    name: 'master',
                    description: 'Default master tag',
                    metadata: {
                        isDefault: true,
                        createdDuringInit: true
                    }
                });
                logFn.info(`Created default master tag with ID: ${masterTag.id}`);
            }
        } catch (error) {
            logFn.warn(`Could not create master tag: ${error.message}`);
        }

        // Create initial config file for backward compatibility
        const configPath = path.join(taskmasterDir, 'config.json');
        if (!fs.existsSync(configPath)) {
            const fileConfig = {
                global: {
                    defaultTag: 'master',
                    logLevel: 'info',
                    rules: rules || ['cursor']
                },
                database: {
                    enabled: true,
                    projectId: newProject.id,
                    userId
                },
                version: '2.0.0-db'
            };

            fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));
            logFn.info(`Created config file: ${configPath}`);
        }

        // Log project initialization in history
        await db.history.log(userId, {
            action: 'project_initialized',
            changeSummary: `Project initialized: ${projectConfig.name}`,
            projectId: newProject.id,
            newValue: {
                projectName: projectConfig.name,
                projectPath: resolvedProjectRoot,
                settings: projectConfig.settings,
                directories: [taskmasterDir, tasksDir, docsDir, templatesDir]
            }
        });

        const successMessage = `Successfully initialized project "${projectConfig.name}" in database`;
        logFn.info(successMessage);

        return {
            success: true,
            project: newProject,
            projectPath: resolvedProjectRoot,
            directories: {
                taskmaster: taskmasterDir,
                tasks: tasksDir,
                docs: docsDir,
                templates: templatesDir
            },
            configFile: configPath,
            message: successMessage
        };

    } catch (error) {
        logFn.error(`Error initializing project: ${error.message}`);
        
        throw new DatabaseError(`Failed to initialize project: ${error.message}`, error.code, {
            options,
            projectRoot: context.projectRoot,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for initializing projects with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function initializeProjectDirect(args, log, context = {}) {
    const {
        addAliases,
        initGit,
        storeTasksInGit,
        skipInstall,
        yes,
        rules,
        projectRoot
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        mcpLog.info(`Initializing project with database operations, ProjectRoot: ${projectRoot}`);

        // Call the database-powered project initialization
        const result = await initializeProjectDb(
            userId,
            {
                addAliases: addAliases === true,
                initGit: initGit === true,
                storeTasksInGit: storeTasksInGit === true,
                skipInstall: skipInstall === true,
                yes: yes === true,
                rules: rules || ['cursor']
            },
            null, // projectId - will be handled in Phase 2
            {
                mcpLog,
                session,
                projectRoot
            }
        );

        return {
            success: true,
            data: {
                message: result.message,
                project: result.project,
                projectPath: result.projectPath,
                directories: result.directories,
                configFile: result.configFile,
                alreadyExists: result.alreadyExists || false
            }
        };

    } catch (error) {
        mcpLog.error(`Error in initializeProjectDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'INITIALIZE_PROJECT_DB_ERROR',
                message: error.message || 'Unknown error initializing project',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { initializeProjectDb };