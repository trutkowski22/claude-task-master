/**
 * dependency-manager.js
 * Manages task dependencies and relationships
 */

import path from 'path';
import {
	readJSON,
	writeJSON,
	taskExists,
	formatTaskId,
	findCycles
} from './utils.js';
import { generateTaskFiles } from './task-manager.js';

/**
 * Add a dependency to a task
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number|string} taskId - ID of the task to add dependency to
 * @param {number|string} dependencyId - ID of the task to add as dependency
 * @param {Object} context - Context object containing projectRoot and tag information
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 */
async function addDependency(tasksPath, taskId, dependencyId, context = {}) {
	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw new Error('No valid tasks found in tasks.json');
	}

	// Format the task and dependency IDs correctly
	const formattedTaskId =
		typeof taskId === 'string' && taskId.includes('.')
			? taskId
			: parseInt(taskId, 10);

	const formattedDependencyId = formatTaskId(dependencyId);

	// Check if the dependency task or subtask actually exists
	if (!taskExists(data.tasks, formattedDependencyId)) {
		throw new Error(`Dependency target ${formattedDependencyId} does not exist in tasks.json`);
	}

	// Find the task to update
	let targetTask = null;
	let isSubtask = false;

	if (typeof formattedTaskId === 'string' && formattedTaskId.includes('.')) {
		// Handle dot notation for subtasks (e.g., "1.2")
		const [parentId, subtaskId] = formattedTaskId
			.split('.')
			.map((id) => parseInt(id, 10));
		const parentTask = data.tasks.find((t) => t.id === parentId);

		if (!parentTask) {
			throw new Error(`Parent task ${parentId} not found.`);
		}

		if (!parentTask.subtasks) {
			throw new Error(`Parent task ${parentId} has no subtasks.`);
		}

		targetTask = parentTask.subtasks.find((s) => s.id === subtaskId);
		isSubtask = true;

		if (!targetTask) {
			throw new Error(`Subtask ${formattedTaskId} not found.`);
		}
	} else {
		// Regular task (not a subtask)
		targetTask = data.tasks.find((t) => t.id === formattedTaskId);

		if (!targetTask) {
			throw new Error(`Task ${formattedTaskId} not found.`);
		}
	}

	// Initialize dependencies array if it doesn't exist
	if (!targetTask.dependencies) {
		targetTask.dependencies = [];
	}

	// Check if dependency already exists
	if (
		targetTask.dependencies.some((d) => {
			// Convert both to strings for comparison to handle both numeric and string IDs
			return String(d) === String(formattedDependencyId);
		})
	) {
		return;
	}

	// Check if the task is trying to depend on itself - compare full IDs (including subtask parts)
	if (String(formattedTaskId) === String(formattedDependencyId)) {
		throw new Error(`Task ${formattedTaskId} cannot depend on itself.`);
	}

	// For subtasks of the same parent, we need to make sure we're not treating it as a self-dependency
	// Check if we're dealing with subtasks with the same parent task
	let isSelfDependency = false;

	if (
		typeof formattedTaskId === 'string' &&
		typeof formattedDependencyId === 'string' &&
		formattedTaskId.includes('.') &&
		formattedDependencyId.includes('.')
	) {
		const [taskParentId] = formattedTaskId.split('.');
		const [depParentId] = formattedDependencyId.split('.');

		// Only treat it as a self-dependency if both the parent ID and subtask ID are identical
		isSelfDependency = formattedTaskId === formattedDependencyId;
	}

	if (isSelfDependency) {
		throw new Error(`Subtask ${formattedTaskId} cannot depend on itself.`);
	}

	// Check for circular dependencies
	const dependencyChain = [formattedTaskId];
	if (
		!isCircularDependency(data.tasks, formattedDependencyId, dependencyChain)
	) {
		// Add the dependency
		targetTask.dependencies.push(formattedDependencyId);

		// Sort dependencies numerically or by parent task ID first, then subtask ID
		targetTask.dependencies.sort((a, b) => {
			if (typeof a === 'number' && typeof b === 'number') {
				return a - b;
			} else if (typeof a === 'string' && typeof b === 'string') {
				const [aParent, aChild] = a.split('.').map(Number);
				const [bParent, bChild] = b.split('.').map(Number);
				return aParent !== bParent ? aParent - bParent : aChild - bChild;
			} else if (typeof a === 'number') {
				return -1; // Numbers come before strings
			} else {
				return 1; // Strings come after numbers
			}
		});

		// Save changes
		writeJSON(tasksPath, data, context.projectRoot, context.tag);
	} else {
		throw new Error(`Cannot add dependency ${formattedDependencyId} to task ${formattedTaskId} as it would create a circular dependency.`);
	}
}

/**
 * Remove a dependency from a task
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number|string} taskId - ID of the task to remove dependency from
 * @param {number|string} dependencyId - ID of the task to remove as dependency
 * @param {Object} context - Context object containing projectRoot and tag information
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 */
async function removeDependency(tasksPath, taskId, dependencyId, context = {}) {
	// Read tasks file
	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw new Error('No valid tasks found.');
	}

	// Format the task and dependency IDs correctly
	const formattedTaskId =
		typeof taskId === 'string' && taskId.includes('.')
			? taskId
			: parseInt(taskId, 10);

	const formattedDependencyId = formatTaskId(dependencyId);

	// Find the task to update
	let targetTask = null;
	let isSubtask = false;

	if (typeof formattedTaskId === 'string' && formattedTaskId.includes('.')) {
		// Handle dot notation for subtasks (e.g., "1.2")
		const [parentId, subtaskId] = formattedTaskId
			.split('.')
			.map((id) => parseInt(id, 10));
		const parentTask = data.tasks.find((t) => t.id === parentId);

		if (!parentTask) {
			throw new Error(`Parent task ${parentId} not found.`);
		}

		if (!parentTask.subtasks) {
			throw new Error(`Parent task ${parentId} has no subtasks.`);
		}

		targetTask = parentTask.subtasks.find((s) => s.id === subtaskId);
		isSubtask = true;

		if (!targetTask) {
			throw new Error(`Subtask ${formattedTaskId} not found.`);
		}
	} else {
		// Regular task (not a subtask)
		targetTask = data.tasks.find((t) => t.id === formattedTaskId);

		if (!targetTask) {
			throw new Error(`Task ${formattedTaskId} not found.`);
		}
	}

	// Check if the task has any dependencies
	if (!targetTask.dependencies || targetTask.dependencies.length === 0) {
		return;
	}

	// Normalize the dependency ID for comparison to handle different formats
	const normalizedDependencyId = String(formattedDependencyId);

	// Check if the dependency exists by comparing string representations
	const dependencyIndex = targetTask.dependencies.findIndex((dep) => {
		// Convert both to strings for comparison
		let depStr = String(dep);

		// Special handling for numeric IDs that might be subtask references
		if (typeof dep === 'number' && dep < 100 && isSubtask) {
			// It's likely a reference to another subtask in the same parent task
			// Convert to full format for comparison (e.g., 2 -> "1.2" for a subtask in task 1)
			const [parentId] = formattedTaskId.split('.');
			depStr = `${parentId}.${dep}`;
		}

		return depStr === normalizedDependencyId;
	});

	if (dependencyIndex === -1) {
		return;
	}

	// Remove the dependency
	targetTask.dependencies.splice(dependencyIndex, 1);

	// Save the updated tasks
	writeJSON(tasksPath, data, context.projectRoot, context.tag);
}

/**
 * Check if adding a dependency would create a circular dependency
 * @param {Array} tasks - Array of all tasks
 * @param {number|string} taskId - ID of task to check
 * @param {Array} chain - Chain of dependencies to check
 * @returns {boolean} True if circular dependency would be created
 */
function isCircularDependency(tasks, taskId, chain = []) {
	// Convert taskId to string for comparison
	const taskIdStr = String(taskId);

	// If we've seen this task before in the chain, we have a circular dependency
	if (chain.some((id) => String(id) === taskIdStr)) {
		return true;
	}

	// Find the task or subtask
	let task = null;
	let parentIdForSubtask = null;

	// Check if this is a subtask reference (e.g., "1.2")
	if (taskIdStr.includes('.')) {
		const [parentId, subtaskId] = taskIdStr.split('.').map(Number);
		const parentTask = tasks.find((t) => t.id === parentId);
		parentIdForSubtask = parentId; // Store parent ID if it's a subtask

		if (parentTask && parentTask.subtasks) {
			task = parentTask.subtasks.find((st) => st.id === subtaskId);
		}
	} else {
		// Regular task
		task = tasks.find((t) => String(t.id) === taskIdStr);
	}

	if (!task) {
		return false; // Task doesn't exist, can't create circular dependency
	}

	// No dependencies, can't create circular dependency
	if (!task.dependencies || task.dependencies.length === 0) {
		return false;
	}

	// Check each dependency recursively
	const newChain = [...chain, taskIdStr]; // Use taskIdStr for consistency
	return task.dependencies.some((depId) => {
		let normalizedDepId = String(depId);
		// Normalize relative subtask dependencies
		if (typeof depId === 'number' && parentIdForSubtask !== null) {
			// If the current task is a subtask AND the dependency is a number,
			// assume it refers to a sibling subtask.
			normalizedDepId = `${parentIdForSubtask}.${depId}`;
		}
		// Pass the normalized ID to the recursive call
		return isCircularDependency(tasks, normalizedDepId, newChain);
	});
}

/**
 * Validate task dependencies
 * @param {Array} tasks - Array of all tasks
 * @returns {Object} Validation result with valid flag and issues array
 */
function validateTaskDependencies(tasks) {
	const issues = [];

	// Check each task's dependencies
	tasks.forEach((task) => {
		if (!task.dependencies) {
			return; // No dependencies to validate
		}

		task.dependencies.forEach((depId) => {
			// Check for self-dependencies
			if (String(depId) === String(task.id)) {
				issues.push({
					type: 'self',
					taskId: task.id,
					message: `Task ${task.id} depends on itself`
				});
				return;
			}

			// Check if dependency exists
			if (!taskExists(tasks, depId)) {
				issues.push({
					type: 'missing',
					taskId: task.id,
					dependencyId: depId,
					message: `Task ${task.id} depends on non-existent task ${depId}`
				});
			}
		});

		// Check for circular dependencies
		if (isCircularDependency(tasks, task.id)) {
			issues.push({
				type: 'circular',
				taskId: task.id,
				message: `Task ${task.id} is part of a circular dependency chain`
			});
		}

		// Check subtask dependencies if they exist
		if (task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				if (!subtask.dependencies) {
					return; // No dependencies to validate
				}

				// Create a full subtask ID for reference
				const fullSubtaskId = `${task.id}.${subtask.id}`;

				subtask.dependencies.forEach((depId) => {
					// Check for self-dependencies in subtasks
					if (
						String(depId) === String(fullSubtaskId) ||
						(typeof depId === 'number' && depId === subtask.id)
					) {
						issues.push({
							type: 'self',
							taskId: fullSubtaskId,
							message: `Subtask ${fullSubtaskId} depends on itself`
						});
						return;
					}

					// Check if dependency exists
					if (!taskExists(tasks, depId)) {
						issues.push({
							type: 'missing',
							taskId: fullSubtaskId,
							dependencyId: depId,
							message: `Subtask ${fullSubtaskId} depends on non-existent task/subtask ${depId}`
						});
					}
				});

				// Check for circular dependencies in subtasks
				if (isCircularDependency(tasks, fullSubtaskId)) {
					issues.push({
						type: 'circular',
						taskId: fullSubtaskId,
						message: `Subtask ${fullSubtaskId} is part of a circular dependency chain`
					});
				}
			});
		}
	});

	return {
		valid: issues.length === 0,
		issues
	};
}

/**
 * Remove duplicate dependencies from tasks
 * @param {Object} tasksData - Tasks data object with tasks array
 * @returns {Object} Updated tasks data with duplicates removed
 */
function removeDuplicateDependencies(tasksData) {
	const tasks = tasksData.tasks.map((task) => {
		if (!task.dependencies) {
			return task;
		}

		// Convert to Set and back to array to remove duplicates
		const uniqueDeps = [...new Set(task.dependencies)];
		return {
			...task,
			dependencies: uniqueDeps
		};
	});

	return {
		...tasksData,
		tasks
	};
}

/**
 * Clean up invalid subtask dependencies
 * @param {Object} tasksData - Tasks data object with tasks array
 * @returns {Object} Updated tasks data with invalid subtask dependencies removed
 */
function cleanupSubtaskDependencies(tasksData) {
	const tasks = tasksData.tasks.map((task) => {
		// Handle task's own dependencies
		if (task.dependencies) {
			task.dependencies = task.dependencies.filter((depId) => {
				// Keep only dependencies that exist
				return taskExists(tasksData.tasks, depId);
			});
		}

		// Handle subtask dependencies
		if (task.subtasks) {
			task.subtasks = task.subtasks.map((subtask) => {
				if (!subtask.dependencies) {
					return subtask;
				}

				// Filter out dependencies to non-existent subtasks
				subtask.dependencies = subtask.dependencies.filter((depId) => {
					return taskExists(tasksData.tasks, depId);
				});

				return subtask;
			});
		}

		return task;
	});

	return {
		...tasksData,
		tasks
	};
}

/**
 * Validate dependencies in task files
 * @param {string} tasksPath - Path to tasks.json
 * @param {Object} options - Options object, including context
 */
async function validateDependenciesCommand(tasksPath, options = {}) {
	const { context = {} } = options;

	// Read tasks data
	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw new Error('No valid tasks found in tasks.json');
	}

	// Count of tasks and subtasks for reporting
	const taskCount = data.tasks.length;
	let subtaskCount = 0;
	data.tasks.forEach((task) => {
		if (task.subtasks && Array.isArray(task.subtasks)) {
			subtaskCount += task.subtasks.length;
		}
	});

	try {
		// Directly call the validation function
		const validationResult = validateTaskDependencies(data.tasks);

		if (!validationResult.valid) {
			throw new Error(`Dependency validation failed. Found ${validationResult.issues.length} issue(s)`);
		}

		return validationResult;
	} catch (error) {
		throw new Error(`Error validating dependencies: ${error.message}`);
	}
}

/**
 * Helper function to count all dependencies across tasks and subtasks
 * @param {Array} tasks - All tasks
 * @returns {number} - Total number of dependencies
 */
function countAllDependencies(tasks) {
	let count = 0;

	tasks.forEach((task) => {
		// Count main task dependencies
		if (task.dependencies && Array.isArray(task.dependencies)) {
			count += task.dependencies.length;
		}

		// Count subtask dependencies
		if (task.subtasks && Array.isArray(task.subtasks)) {
			task.subtasks.forEach((subtask) => {
				if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
					count += subtask.dependencies.length;
				}
			});
		}
	});

	return count;
}

/**
 * Fixes invalid dependencies in tasks.json
 * @param {string} tasksPath - Path to tasks.json
 * @param {Object} options - Options object, including context
 */
async function fixDependenciesCommand(tasksPath, options = {}) {
	const { context = {} } = options;

	try {
		// Read tasks data
		const data = readJSON(tasksPath, context.projectRoot, context.tag);
		if (!data || !data.tasks) {
			throw new Error('No valid tasks found in tasks.json');
		}

		// Create a deep copy of the original data for comparison
		const originalData = JSON.parse(JSON.stringify(data));

		// Track fixes for reporting
		const stats = {
			nonExistentDependenciesRemoved: 0,
			selfDependenciesRemoved: 0,
			duplicateDependenciesRemoved: 0,
			circularDependenciesFixed: 0,
			tasksFixed: 0,
			subtasksFixed: 0
		};

		// First phase: Remove duplicate dependencies in tasks
		data.tasks.forEach((task) => {
			if (task.dependencies && Array.isArray(task.dependencies)) {
				const uniqueDeps = new Set();
				const originalLength = task.dependencies.length;
				task.dependencies = task.dependencies.filter((depId) => {
					const depIdStr = String(depId);
					if (uniqueDeps.has(depIdStr)) {
						stats.duplicateDependenciesRemoved++;
						return false;
					}
					uniqueDeps.add(depIdStr);
					return true;
				});
				if (task.dependencies.length < originalLength) {
					stats.tasksFixed++;
				}
			}

			// Check for duplicates in subtasks
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
						const uniqueDeps = new Set();
						const originalLength = subtask.dependencies.length;
						subtask.dependencies = subtask.dependencies.filter((depId) => {
							let depIdStr = String(depId);
							if (typeof depId === 'number' && depId < 100) {
								depIdStr = `${task.id}.${depId}`;
							}
							if (uniqueDeps.has(depIdStr)) {
								stats.duplicateDependenciesRemoved++;
								return false;
							}
							uniqueDeps.add(depIdStr);
							return true;
						});
						if (subtask.dependencies.length < originalLength) {
							stats.subtasksFixed++;
						}
					}
				});
			}
		});

		// Create validity maps for tasks and subtasks
		const validTaskIds = new Set(data.tasks.map((t) => t.id));
		const validSubtaskIds = new Set();
		data.tasks.forEach((task) => {
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					validSubtaskIds.add(`${task.id}.${subtask.id}`);
				});
			}
		});

		// Second phase: Remove invalid task dependencies (non-existent tasks)
		data.tasks.forEach((task) => {
			if (task.dependencies && Array.isArray(task.dependencies)) {
				const originalLength = task.dependencies.length;
				task.dependencies = task.dependencies.filter((depId) => {
					const isSubtask = typeof depId === 'string' && depId.includes('.');

					if (isSubtask) {
						// Check if the subtask exists
						if (!validSubtaskIds.has(depId)) {
							stats.nonExistentDependenciesRemoved++;
							return false;
						}
						return true;
					} else {
						// Check if the task exists
						const numericId =
							typeof depId === 'string' ? parseInt(depId, 10) : depId;
						if (!validTaskIds.has(numericId)) {
							stats.nonExistentDependenciesRemoved++;
							return false;
						}
						return true;
					}
				});

				if (task.dependencies.length < originalLength) {
					stats.tasksFixed++;
				}
			}

			// Check subtask dependencies for invalid references
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
						const originalLength = subtask.dependencies.length;
						const subtaskId = `${task.id}.${subtask.id}`;

						// First check for self-dependencies
						const hasSelfDependency = subtask.dependencies.some((depId) => {
							if (typeof depId === 'string' && depId.includes('.')) {
								return depId === subtaskId;
							} else if (typeof depId === 'number' && depId < 100) {
								return depId === subtask.id;
							}
							return false;
						});

						if (hasSelfDependency) {
							subtask.dependencies = subtask.dependencies.filter((depId) => {
								const normalizedDepId =
									typeof depId === 'number' && depId < 100
										? `${task.id}.${depId}`
										: String(depId);

								if (normalizedDepId === subtaskId) {
									stats.selfDependenciesRemoved++;
									return false;
								}
								return true;
							});
						}

						// Then check for non-existent dependencies
						subtask.dependencies = subtask.dependencies.filter((depId) => {
							if (typeof depId === 'string' && depId.includes('.')) {
								if (!validSubtaskIds.has(depId)) {
									stats.nonExistentDependenciesRemoved++;
									return false;
								}
								return true;
							}

							// Handle numeric dependencies
							const numericId =
								typeof depId === 'number' ? depId : parseInt(depId, 10);

							// Small numbers likely refer to subtasks in the same task
							if (numericId < 100) {
								const fullSubtaskId = `${task.id}.${numericId}`;

								if (!validSubtaskIds.has(fullSubtaskId)) {
									stats.nonExistentDependenciesRemoved++;
									return false;
								}

								return true;
							}

							// Otherwise it's a task reference
							if (!validTaskIds.has(numericId)) {
								stats.nonExistentDependenciesRemoved++;
								return false;
							}

							return true;
						});

						if (subtask.dependencies.length < originalLength) {
							stats.subtasksFixed++;
						}
					}
				});
			}
		});

		// Third phase: Check for circular dependencies
		// Build the dependency map for subtasks
		const subtaskDependencyMap = new Map();
		data.tasks.forEach((task) => {
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					const subtaskId = `${task.id}.${subtask.id}`;

					if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
						const normalizedDeps = subtask.dependencies.map((depId) => {
							if (typeof depId === 'string' && depId.includes('.')) {
								return depId;
							} else if (typeof depId === 'number' && depId < 100) {
								return `${task.id}.${depId}`;
							}
							return String(depId);
						});
						subtaskDependencyMap.set(subtaskId, normalizedDeps);
					} else {
						subtaskDependencyMap.set(subtaskId, []);
					}
				});
			}
		});

		// Check for and fix circular dependencies
		for (const [subtaskId, dependencies] of subtaskDependencyMap.entries()) {
			const visited = new Set();
			const recursionStack = new Set();

			// Detect cycles
			const cycleEdges = findCycles(
				subtaskId,
				subtaskDependencyMap,
				visited,
				recursionStack
			);

			if (cycleEdges.length > 0) {
				const [taskId, subtaskNum] = subtaskId
					.split('.')
					.map((part) => Number(part));
				const task = data.tasks.find((t) => t.id === taskId);

				if (task && task.subtasks) {
					const subtask = task.subtasks.find((st) => st.id === subtaskNum);

					if (subtask && subtask.dependencies) {
						const originalLength = subtask.dependencies.length;

						const edgesToRemove = cycleEdges.map((edge) => {
							if (edge.includes('.')) {
								const [depTaskId, depSubtaskId] = edge
									.split('.')
									.map((part) => Number(part));

								if (depTaskId === taskId) {
									return depSubtaskId;
								}

								return edge;
							}

							return Number(edge);
						});

						subtask.dependencies = subtask.dependencies.filter((depId) => {
							const normalizedDepId =
								typeof depId === 'number' && depId < 100
									? `${taskId}.${depId}`
									: String(depId);

							if (
								edgesToRemove.includes(depId) ||
								edgesToRemove.includes(normalizedDepId)
							) {
								stats.circularDependenciesFixed++;
								return false;
							}
							return true;
						});

						if (subtask.dependencies.length < originalLength) {
							stats.subtasksFixed++;
						}
					}
				}
			}
		}

		// Check if any changes were made by comparing with original data
		const dataChanged = JSON.stringify(data) !== JSON.stringify(originalData);

		if (dataChanged) {
			// Save the changes
			writeJSON(tasksPath, data, context.projectRoot, context.tag);
		}

		return stats;
	} catch (error) {
		throw new Error(`Error in fix-dependencies command: ${error.message}`);
	}
}

/**
 * Ensure at least one subtask in each task has no dependencies
 * @param {Object} tasksData - The tasks data object with tasks array
 * @returns {boolean} - True if any changes were made
 */
function ensureAtLeastOneIndependentSubtask(tasksData) {
	if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks)) {
		return false;
	}

	let changesDetected = false;

	tasksData.tasks.forEach((task) => {
		if (
			!task.subtasks ||
			!Array.isArray(task.subtasks) ||
			task.subtasks.length === 0
		) {
			return;
		}

		// Check if any subtask has no dependencies
		const hasIndependentSubtask = task.subtasks.some(
			(st) =>
				!st.dependencies ||
				!Array.isArray(st.dependencies) ||
				st.dependencies.length === 0
		);

		if (!hasIndependentSubtask) {
			// Find the first subtask and clear its dependencies
			if (task.subtasks.length > 0) {
				const firstSubtask = task.subtasks[0];
				firstSubtask.dependencies = [];
				changesDetected = true;
			}
		}
	});

	return changesDetected;
}

/**
 * Validate and fix dependencies across all tasks and subtasks
 * This function is designed to be called after any task modification
 * @param {Object} tasksData - The tasks data object with tasks array
 * @param {string} tasksPath - Optional path to save the changes
 * @param {string} projectRoot - Optional project root for tag context
 * @param {string} tag - Optional tag for tag context
 * @returns {boolean} - True if any changes were made
 */
function validateAndFixDependencies(
	tasksData,
	tasksPath = null,
	projectRoot = null,
	tag = null
) {
	if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks)) {
		throw new Error('Invalid tasks data');
	}

	// Create a deep copy for comparison
	const originalData = JSON.parse(JSON.stringify(tasksData));

	// 1. Remove duplicate dependencies from tasks and subtasks
	tasksData.tasks = tasksData.tasks.map((task) => {
		// Handle task dependencies
		if (task.dependencies) {
			const uniqueDeps = [...new Set(task.dependencies)];
			task.dependencies = uniqueDeps;
		}

		// Handle subtask dependencies
		if (task.subtasks) {
			task.subtasks = task.subtasks.map((subtask) => {
				if (subtask.dependencies) {
					const uniqueDeps = [...new Set(subtask.dependencies)];
					subtask.dependencies = uniqueDeps;
				}
				return subtask;
			});
		}
		return task;
	});

	// 2. Remove invalid task dependencies (non-existent tasks)
	tasksData.tasks.forEach((task) => {
		// Clean up task dependencies
		if (task.dependencies) {
			task.dependencies = task.dependencies.filter((depId) => {
				// Remove self-dependencies
				if (String(depId) === String(task.id)) {
					return false;
				}
				// Remove non-existent dependencies
				return taskExists(tasksData.tasks, depId);
			});
		}

		// Clean up subtask dependencies
		if (task.subtasks) {
			task.subtasks.forEach((subtask) => {
				if (subtask.dependencies) {
					subtask.dependencies = subtask.dependencies.filter((depId) => {
						// Handle numeric subtask references
						if (typeof depId === 'number' && depId < 100) {
							const fullSubtaskId = `${task.id}.${depId}`;
							return taskExists(tasksData.tasks, fullSubtaskId);
						}
						// Handle full task/subtask references
						return taskExists(tasksData.tasks, depId);
					});
				}
			});
		}
	});

	// 3. Ensure at least one subtask has no dependencies in each task
	tasksData.tasks.forEach((task) => {
		if (task.subtasks && task.subtasks.length > 0) {
			const hasIndependentSubtask = task.subtasks.some(
				(st) =>
					!st.dependencies ||
					!Array.isArray(st.dependencies) ||
					st.dependencies.length === 0
			);

			if (!hasIndependentSubtask) {
				task.subtasks[0].dependencies = [];
			}
		}
	});

	// Check if any changes were made by comparing with original data
	const changesDetected =
		JSON.stringify(tasksData) !== JSON.stringify(originalData);

	// Save changes if needed
	if (tasksPath && changesDetected) {
		try {
			writeJSON(tasksPath, tasksData, projectRoot, tag);
		} catch (error) {
			throw new Error(`Failed to save dependency fixes to tasks.json: ${error.message}`);
		}
	}

	return changesDetected;
}

export {
	addDependency,
	removeDependency,
	isCircularDependency,
	validateTaskDependencies,
	validateDependenciesCommand,
	fixDependenciesCommand,
	removeDuplicateDependencies,
	cleanupSubtaskDependencies,
	ensureAtLeastOneIndependentSubtask,
	validateAndFixDependencies
};