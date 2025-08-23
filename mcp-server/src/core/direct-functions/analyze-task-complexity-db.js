/**
 * analyze-task-complexity-db.js
 * Database-powered implementation for analyzing task complexity
 * 
 * This replaces the file-based analyze-task-complexity.js with database operations
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
 * Calculate task complexity score based on multiple factors
 * @param {Object} task - Task object
 * @returns {number} - Complexity score (1-10)
 */
function calculateComplexityScore(task) {
    let score = 1; // Base score

    // Factor 1: Task description length and complexity
    const descriptionLength = (task.description || '').length;
    if (descriptionLength > 500) score += 2;
    else if (descriptionLength > 200) score += 1;

    // Factor 2: Number of dependencies
    const dependencyCount = (task.dependencies || []).length;
    if (dependencyCount > 5) score += 2;
    else if (dependencyCount > 2) score += 1;

    // Factor 3: Number of existing subtasks
    const subtaskCount = (task.subtasks || []).length;
    if (subtaskCount > 10) score += 2;
    else if (subtaskCount > 5) score += 1;
    else if (subtaskCount === 0) score += 1; // Might need breaking down

    // Factor 4: Priority level
    if (task.priority === 'high') score += 1;
    else if (task.priority === 'critical') score += 2;

    // Factor 5: Keywords indicating complexity
    const complexKeywords = ['integration', 'algorithm', 'optimization', 'architecture', 'refactor', 'migration'];
    const taskText = `${task.title} ${task.description}`.toLowerCase();
    const keywordMatches = complexKeywords.filter(keyword => taskText.includes(keyword)).length;
    score += Math.min(keywordMatches, 3); // Max 3 points for keywords

    // Factor 6: Test strategy complexity
    if (task.testStrategy && task.testStrategy.length > 100) score += 1;

    // Factor 7: Acceptance criteria count
    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 5) score += 1;

    // Cap at 10
    return Math.min(score, 10);
}

/**
 * Generate expansion recommendations based on complexity
 * @param {number} complexityScore - Task complexity score
 * @param {Object} task - Task object
 * @returns {Object} - Recommendation object
 */
function generateRecommendations(complexityScore, task) {
    const recommendations = {
        shouldExpand: false,
        reason: '',
        suggestedSubtasks: 3,
        priority: 'medium'
    };

    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
    const isCompleted = task.status === 'done' || task.status === 'completed';

    if (isCompleted) {
        recommendations.reason = 'Task is completed - no expansion needed';
        return recommendations;
    }

    if (complexityScore >= 8) {
        recommendations.shouldExpand = true;
        recommendations.reason = 'High complexity task should be broken down into subtasks';
        recommendations.suggestedSubtasks = hasSubtasks ? task.subtasks.length + 2 : 7;
        recommendations.priority = 'high';
    } else if (complexityScore >= 6) {
        if (!hasSubtasks) {
            recommendations.shouldExpand = true;
            recommendations.reason = 'Medium complexity task could benefit from subtasks';
            recommendations.suggestedSubtasks = 5;
            recommendations.priority = 'medium';
        } else {
            recommendations.reason = 'Task has appropriate subtask breakdown';
        }
    } else if (complexityScore >= 4) {
        if (!hasSubtasks && (task.description || '').length > 200) {
            recommendations.shouldExpand = true;
            recommendations.reason = 'Task description suggests multiple steps';
            recommendations.suggestedSubtasks = 3;
            recommendations.priority = 'low';
        } else {
            recommendations.reason = 'Task complexity is manageable';
        }
    } else {
        recommendations.reason = 'Low complexity task - expansion not recommended';
    }

    return recommendations;
}

/**
 * Database-powered task complexity analysis function
 * @param {string} userId - User ID (extracted from auth context)
 * @param {Object} options - Analysis options
 * @param {string} options.outputPath - Path to save the complexity report
 * @param {number} options.threshold - Minimum complexity score to recommend expansion
 * @param {boolean} options.research - Use research-backed analysis
 * @param {string} options.ids - Comma-separated task IDs to analyze
 * @param {number} options.from - Starting task ID range
 * @param {number} options.to - Ending task ID range
 * @param {string} options.tag - Tag context
 * @param {string} projectId - Project ID (optional)
 * @param {Object} context - Context object containing session and other data
 * @returns {Promise<Object>} Complexity analysis result
 */
async function analyzeTaskComplexityDb(
    userId,
    options = {},
    projectId = null,
    context = {}
) {
    const { mcpLog, session } = context;
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
            throw new DatabaseError('User ID is required for complexity analysis');
        }

        const {
            outputPath,
            threshold = 5,
            research = false,
            ids,
            from,
            to,
            tag
        } = options;

        if (!outputPath) {
            throw new DatabaseError('Output path is required for complexity analysis');
        }

        logFn.info(`Analyzing task complexity from database. Research: ${research}, Threshold: ${threshold}`);

        // Get tasks to analyze
        let tasksToAnalyze = [];
        
        if (ids) {
            // Analyze specific task IDs
            const taskIds = ids.split(',').map(id => parseInt(id.trim(), 10));
            logFn.info(`Analyzing specific task IDs: ${taskIds.join(', ')}`);
            
            for (const taskId of taskIds) {
                const task = await db.tasks.getByTaskNumber(userId, taskId);
                if (task) {
                    tasksToAnalyze.push(task);
                } else {
                    logFn.warn(`Task #${taskId} not found`);
                }
            }
        } else if (from !== undefined || to !== undefined) {
            // Analyze task range
            const allTasks = await db.tasks.getAll(userId);
            const fromId = from || 1;
            const toId = to || Math.max(...allTasks.map(t => t.task_number));
            
            logFn.info(`Analyzing tasks in range: ${fromId} to ${toId}`);
            tasksToAnalyze = allTasks.filter(task => 
                task.task_number >= fromId && task.task_number <= toId
            );
        } else {
            // Analyze all tasks
            tasksToAnalyze = await db.tasks.getAll(userId);
            logFn.info(`Analyzing all ${tasksToAnalyze.length} tasks`);
        }

        if (tasksToAnalyze.length === 0) {
            logFn.warn('No tasks found to analyze');
            return {
                success: false,
                message: 'No tasks found to analyze'
            };
        }

        // Analyze each task
        const complexityAnalysis = [];
        let highComplexityCount = 0;
        let mediumComplexityCount = 0;
        let lowComplexityCount = 0;
        let tasksRecommendedForExpansion = 0;

        for (const task of tasksToAnalyze) {
            const complexityScore = calculateComplexityScore(task);
            const recommendations = generateRecommendations(complexityScore, task);
            
            const analysis = {
                id: task.task_number,
                title: task.title,
                status: task.status,
                priority: task.priority || 'medium',
                complexityScore,
                complexityLevel: complexityScore >= 8 ? 'high' : 
                               complexityScore >= 5 ? 'medium' : 'low',
                hasSubtasks: (task.subtasks || []).length > 0,
                subtaskCount: (task.subtasks || []).length,
                dependencyCount: (task.dependencies || []).length,
                descriptionLength: (task.description || '').length,
                recommendations
            };

            // Add research-backed insights if enabled
            if (research) {
                analysis.researchInsights = {
                    note: 'Research-backed analysis would provide deeper insights based on task domain and industry best practices',
                    suggestedResources: ['Documentation review', 'Architecture analysis', 'Best practices research']
                };
            }

            complexityAnalysis.push(analysis);

            // Count by complexity level
            if (complexityScore >= 8) highComplexityCount++;
            else if (complexityScore >= 5) mediumComplexityCount++;
            else lowComplexityCount++;

            if (recommendations.shouldExpand) tasksRecommendedForExpansion++;

            logFn.info(`Task #${task.task_number}: complexity score ${complexityScore} (${analysis.complexityLevel})`);
        }

        // Generate summary report
        const report = {
            analysisMetadata: {
                timestamp: new Date().toISOString(),
                userId,
                totalTasksAnalyzed: tasksToAnalyze.length,
                analysisOptions: {
                    threshold,
                    research,
                    specificIds: ids || null,
                    taskRange: from !== undefined || to !== undefined ? { from, to } : null
                }
            },
            summary: {
                taskCount: tasksToAnalyze.length,
                highComplexityTasks: highComplexityCount,
                mediumComplexityTasks: mediumComplexityCount,
                lowComplexityTasks: lowComplexityCount,
                tasksRecommendedForExpansion,
                averageComplexity: complexityAnalysis.reduce((sum, t) => sum + t.complexityScore, 0) / complexityAnalysis.length
            },
            complexityAnalysis,
            recommendations: {
                summary: `${tasksRecommendedForExpansion} of ${tasksToAnalyze.length} tasks are recommended for expansion`,
                thresholdMet: complexityAnalysis.filter(t => t.complexityScore >= threshold).length,
                actionItems: complexityAnalysis
                    .filter(t => t.recommendations.shouldExpand)
                    .map(t => ({
                        taskId: t.id,
                        title: t.title,
                        action: 'expand',
                        suggestedSubtasks: t.recommendations.suggestedSubtasks,
                        priority: t.recommendations.priority
                    }))
            }
        };

        // Save report to file
        try {
            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Write report as JSON
            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
            logFn.info(`Complexity analysis report saved to ${outputPath}`);
        } catch (error) {
            throw new DatabaseError(`Failed to save report to ${outputPath}: ${error.message}`);
        }

        // Log complexity analysis in history
        await db.history.log(userId, {
            action: 'complexity_analysis',
            changeSummary: `Complexity analysis completed for ${tasksToAnalyze.length} tasks`,
            newValue: {
                tasksAnalyzed: tasksToAnalyze.length,
                highComplexityTasks: highComplexityCount,
                mediumComplexityTasks: mediumComplexityCount,
                lowComplexityTasks: lowComplexityCount,
                tasksRecommendedForExpansion,
                reportPath: outputPath,
                analysisOptions: { threshold, research }
            }
        });

        const successMessage = `Task complexity analysis complete. Report saved to ${outputPath}`;
        logFn.info(successMessage);

        return {
            success: true,
            report,
            message: successMessage,
            telemetryData: {
                tasksAnalyzed: tasksToAnalyze.length,
                complexityScores: complexityAnalysis.map(t => t.complexityScore),
                research
            }
        };

    } catch (error) {
        logFn.error(`Error analyzing task complexity: ${error.message}`);
        
        throw new DatabaseError(`Failed to analyze task complexity: ${error.message}`, error.code, {
            options,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Direct function wrapper for analyzing task complexity with database operations
 * 
 * This maintains the same API as the original file-based function
 */
export async function analyzeTaskComplexityDirect(args, log, context = {}) {
    const {
        tasksJsonPath,
        outputPath,
        threshold,
        research,
        projectRoot,
        ids,
        from,
        to,
        tag
    } = args;
    
    const { session } = context;
    const mcpLog = createLogWrapper(log);

    try {
        // Extract user ID from context
        const userId = getUserId(context);

        if (!outputPath) {
            mcpLog.error('analyzeTaskComplexityDirect called without outputPath');
            return {
                success: false,
                error: { 
                    code: 'MISSING_ARGUMENT', 
                    message: 'outputPath is required' 
                }
            };
        }

        mcpLog.info(`Analyzing task complexity from database, ProjectRoot: ${projectRoot}`);

        if (ids) {
            mcpLog.info(`Analyzing specific task IDs: ${ids}`);
        } else if (from || to) {
            const fromStr = from !== undefined ? from : 'first';
            const toStr = to !== undefined ? to : 'last';
            mcpLog.info(`Analyzing tasks in range: ${fromStr} to ${toStr}`);
        }

        if (research) {
            mcpLog.info('Using research role for complexity analysis');
        }

        // Call the database-powered complexity analysis
        const result = await analyzeTaskComplexityDb(
            userId,
            {
                outputPath,
                threshold: threshold ? parseInt(threshold, 10) : 5,
                research: research === true,
                ids,
                from: from ? parseInt(from, 10) : undefined,
                to: to ? parseInt(to, 10) : undefined,
                tag
            },
            null, // projectId - will be handled in Phase 2
            {
                mcpLog,
                session,
                projectRoot
            }
        );

        // Verify the report file was created
        if (!fs.existsSync(outputPath)) {
            return {
                success: false,
                error: {
                    code: 'ANALYZE_REPORT_MISSING',
                    message: 'Analysis completed but no report file was created at the expected path.'
                }
            };
        }

        const summary = result.report.summary;
        
        return {
            success: true,
            data: {
                message: result.message,
                reportPath: outputPath,
                reportSummary: {
                    taskCount: summary.taskCount,
                    highComplexityTasks: summary.highComplexityTasks,
                    mediumComplexityTasks: summary.mediumComplexityTasks,
                    lowComplexityTasks: summary.lowComplexityTasks
                },
                fullReport: result.report,
                telemetryData: result.telemetryData
            }
        };

    } catch (error) {
        mcpLog.error(`Error in analyzeTaskComplexityDirect: ${error.message}`);
        return {
            success: false,
            error: {
                code: error.code || 'ANALYZE_COMPLEXITY_DB_ERROR',
                message: error.message || 'Unknown error analyzing task complexity',
                details: error.details
            }
        };
    }
}

// Export the database-powered function for use by other modules
export { analyzeTaskComplexityDb };