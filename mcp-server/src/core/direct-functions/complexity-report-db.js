/**
 * complexity-report-db.js
 * Database-powered implementation for complexity report functionality
 *
 * This replaces the file-based complexity-report.js with database operations
 */

import { createLogWrapper } from '../../tools/utils.js';
import { DatabaseError } from '../../database/index.js';
import { supabase } from '../../database/config.js';
import {
	enableSilentMode,
	disableSilentMode,
	readComplexityReport
} from '../../../scripts/modules/utils.js';

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
 * COMPLEXITY REPORT OPERATIONS
 * TODO: Add these to the main database operations module when ready
 */
const ComplexityReportOps = {
	/**
	 * Store complexity report in database
	 */
	async create(userId, reportData) {
		const response = await supabase
			.from('complexity_reports')
			.insert({
				user_id: userId,
				name: reportData.name || 'Complexity Report',
				description: reportData.description || '',
				report_data: reportData.data,
				source: reportData.source || 'generated',
				source_path: reportData.sourcePath || null,
				project_id: reportData.projectId || null
			})
			.select()
			.single();

		if (response.error) {
			throw new DatabaseError(`Failed to store complexity report: ${response.error.message}`, response.error.code);
		}

		return response.data;
	},

	/**
	 * Retrieve complexity report from database
	 */
	async getLatest(userId) {
		const response = await supabase
			.from('complexity_reports')
			.select('*')
			.eq('user_id', userId)
			.order('created_at', { ascending: false })
			.limit(1);

		if (response.error) {
			throw new DatabaseError(`Failed to retrieve complexity report: ${response.error.message}`, response.error.code);
		}

		if (!response.data || response.data.length === 0) {
			return null;
		}

		return response.data[0];
	},

	/**
	 * Get complexity report by ID
	 */
	async getById(userId, reportId) {
		const response = await supabase
			.from('complexity_reports')
			.select('*')
			.eq('id', reportId)
			.eq('user_id', userId)
			.single();

		if (response.error) {
			throw new DatabaseError(`Failed to retrieve complexity report: ${response.error.message}`, response.error.code);
		}

		return response.data;
	}
};

/**
 * Database-powered complexity report function
 * @param {string} userId - User ID
 * @param {Object} args - Complexity report arguments
 * @param {Object} log - Logger object
 * @param {Object} context - Additional context
 * @returns {Promise<Object>} - Result object
 */
async function complexityReportDb(userId, args, log, context = {}) {
	const { reportPath, storeInDb = false } = args;

	// Enable silent mode to prevent console logs from interfering with JSON response
	enableSilentMode();

	try {
		// Validate user ID
		if (!userId) {
			throw new DatabaseError('User ID is required for complexity report operations');
		}

		log.info(`Performing database-powered complexity report for user: ${userId}`);

		// First try to get from database
		let dbReport = await ComplexityReportOps.getLatest(userId);
	
		if (dbReport) {
			return {
				success: true,
				data: {
					report: dbReport.report_data,
					reportId: dbReport.id,
					created_at: dbReport.created_at,
					source: 'database'
				}
			};
		}
	
		// If no database report found, try to read from file and optionally store in DB
		if (reportPath) {
			log.info(`No database report found, attempting to read from file: ${reportPath}`);
	
			try {
				const fileReport = readComplexityReport(reportPath);
	
				if (fileReport) {
					// If storeInDb is true, save the file report to database
					if (storeInDb) {
						try {
							const reportData = {
								name: `Complexity Report from ${reportPath}`,
								description: 'Imported from file-based complexity analysis',
								data: fileReport,
								source: 'file',
								sourcePath: reportPath
							};
	
							const storedReport = await ComplexityReportOps.create(userId, reportData);
							log.info('Successfully stored file-based complexity report in database');
	
							return {
								success: true,
								data: {
									report: fileReport,
									reportId: storedReport.id,
									created_at: storedReport.created_at,
									source: 'file'
								}
							};
						} catch (storeError) {
							log.warn(`Error storing complexity report in database: ${storeError.message}`);
							// Continue and return file report even if storage fails
						}
					}
	
					// Return the file-based report
					return {
						success: true,
						data: {
							report: fileReport,
							reportPath,
							source: 'file'
						}
					};
				}
			} catch (fileError) {
				log.warn(`Error reading complexity report from file: ${fileError.message}`);
			}
		}
	
		// No report found anywhere
		return {
			success: false,
			error: {
				code: 'NOT_FOUND',
				message: 'No complexity report found. Run task-master analyze-complexity first.'
			}
		};

	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error in complexityReportDb: ${error.message}`);

		throw new DatabaseError(`Failed to retrieve complexity report: ${error.message}`, error.code);
	} finally {
		// Ensure silent mode is disabled
		disableSilentMode();
	}
}

/**
 * Direct function wrapper for complexity report with database operations
 *
 * This is the main entry point that replaces the file-based complexityReportDirect function
 */
export async function complexityReportDirect(args, log, context = {}) {
	const { reportPath, storeInDb = false } = args;

	const { session } = context;

	// Create logger wrapper
	const mcpLog = createLogWrapper(log);

	try {
		// Extract user ID from context (will be from JWT in Phase 2)
		const userId = getUserId(context);

		// Prepare complexity report arguments
		const reportArgs = {
			reportPath,
			storeInDb
		};

		// Call the database-powered complexity report function
		const result = await complexityReportDb(
			userId,
			reportArgs,
			log,
			{ session }
		);

		return result;

	} catch (error) {
		log.error(`Error in complexityReportDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code: error.code || 'COMPLEXITY_REPORT_ERROR',
				message: error.message
			}
		};
	}
}