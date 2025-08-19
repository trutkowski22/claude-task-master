import path from 'path';
import { readJSON, writeJSON } from '../utils.js';

/**
 * Clear subtasks from specified tasks
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} taskIds - Task IDs to clear subtasks from
 * @param {Object} context - Context object containing projectRoot and tag
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 */
function clearSubtasks(tasksPath, taskIds, context = {}) {
	const { projectRoot, tag } = context;
	const data = readJSON(tasksPath, projectRoot, tag);
	if (!data || !data.tasks) {
		throw new Error('No valid tasks found.');
	}

	// Handle multiple task IDs (comma-separated)
	const taskIdArray = taskIds.split(',').map((id) => id.trim());
	let clearedCount = 0;
	const results = [];

	taskIdArray.forEach((taskId) => {
		const id = parseInt(taskId, 10);
		if (Number.isNaN(id)) {
			throw new Error(`Invalid task ID: ${taskId}`);
		}

		const task = data.tasks.find((t) => t.id === id);
		if (!task) {
			throw new Error(`Task ${id} not found`);
		}

		if (!task.subtasks || task.subtasks.length === 0) {
			results.push({
				taskId: id,
				title: task.title,
				subtasksCleared: 0,
				message: 'No subtasks to clear'
			});
			return;
		}

		const subtaskCount = task.subtasks.length;
		task.subtasks = [];
		clearedCount++;

		results.push({
			taskId: id,
			title: task.title,
			subtasksCleared: subtaskCount,
			message: `${subtaskCount} subtasks cleared`
		});
	});

	if (clearedCount > 0) {
		writeJSON(tasksPath, data, projectRoot, tag);
	}

	return {
		clearedCount,
		results
	};
}

export default clearSubtasks;