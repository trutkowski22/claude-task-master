# Database Migration Test Suite

This directory contains comprehensive tests for verifying the database migration from file-based operations to Supabase PostgreSQL.

## Files

- `database-migration-test-suite.js` - Main test suite that tests all 31 migrated functions
- `database-migration-test-results.json` - Generated test results (after running tests)

## Prerequisites

1. **Environment Setup**: Ensure `.env` file contains valid Supabase credentials:
   ```
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_ANON_KEY="your-anon-key"
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   ```

2. **Test User**: A test user must exist in Supabase Auth system. The test suite will look for `test-user-id.txt` in the root directory.

## Running Tests

### Option 1: Full Test Suite (Recommended)
```bash
node tests/database-migration-test-suite.js
```

### Option 2: Quick Test (if test user doesn't exist)
```bash
node setup-test-user.js  # Creates test user first
node tests/database-migration-test-suite.js
```

## Test Coverage

The test suite covers all 31 migrated functions:

### Task Management (8 functions)
- `add-task.js` - Task creation with AI integration
- `update-task-by-id.js` - Task updates with audit logging
- `show-task.js` - Task retrieval with subtask inclusion
- `list-tasks.js` - Task listing with filtering
- `remove-task.js` - Task deletion with cascade
- `set-task-status.js` - Status updates with validation
- `move-task.js` - Move logging functionality
- `next-task.js` - Intelligent next task selection

### Subtask Management (4 functions)
- `add-subtask.js` - Subtask creation and conversion
- `update-subtask-by-id.js` - Subtask updates
- `remove-subtask.js` - Subtask deletion and conversion
- `clear-subtasks.js` - Bulk subtask operations

### Tag Management (6 functions)
- `add-tag.js` - Tag creation with validation
- `list-tags.js` - Tag listing and filtering
- `use-tag.js` - Tag switching functionality
- `rename-tag.js` - Tag renaming
- `delete-tag.js` - Tag deletion with cleanup
- `copy-tag.js` - Tag duplication

### Dependency Management (4 functions)
- `add-dependency.js` - Dependency creation with cycle detection
- `remove-dependency.js` - Dependency removal
- `validate-dependencies.js` - Dependency validation
- `fix-dependencies.js` - Auto-fix dependency issues

### Task Generation & Analysis (5 functions)
- `generate-task-files.js` - File generation from tasks
- `parse-prd.js` - PRD parsing and task extraction
- `research.js` - Research operations
- `complexity-report.js` - Complexity analysis
- `cache-stats.js` - Cache statistics

### Additional Functions (4 functions)
- `expand-task.js` - Task expansion with AI
- `expand-all-tasks.js` - Bulk task expansion
- `analyze-task-complexity.js` - Complexity analysis
- `scope-up.js` / `scope-down.js` - Task scope adjustment

### Project & Configuration (4 functions)
- `initialize-project.js` - Project initialization
- `models.js` - AI model configuration
- `rules.js` - Rule management
- `response-language.js` - Language settings

## Expected Output

```
================================================================================
FINAL DATABASE MIGRATION VERIFICATION TEST
================================================================================
Using test user ID: 8e8c0d00-6de9-4eab-b7b7-78205cb1c4cf

🧪 Testing Task Management Functions...
✅ add-task - PASSED
✅ update-task-by-id - PASSED
✅ show-task - PASSED
✅ list-tasks - PASSED
✅ remove-task - PASSED
✅ set-task-status - PASSED
✅ move-task - PASSED
✅ next-task - PASSED

🧪 Testing Subtask Management Functions...
✅ add-subtask - PASSED
✅ update-subtask-by-id - PASSED
✅ remove-subtask - PASSED
✅ clear-subtasks - PASSED

[... continues for all categories ...]

================================================================================
FINAL TEST RESULTS
================================================================================
Total Functions Tested: 31
Passed: 31
Failed: 0
Success Rate: 100.0%

Breakdown by Category:
- Task Management: 8/8 passed (100.0%)
- Subtask Management: 4/4 passed (100.0%)
- Tag Management: 6/6 passed (100.0%)
- Dependency Management: 4/4 passed (100.0%)
- Task Generation & Analysis: 9/9 passed (100.0%)
- Project & Configuration: 4/4 passed (100.0%)
```

## Test Results

After running the tests, a detailed report is saved to `database-migration-test-results.json` containing:
- Individual function test results
- Error details for failed tests
- Performance metrics
- Test data created during testing

## Troubleshooting

### Common Issues

1. **Test user not found**: Run `setup-test-user.js` first
2. **Database connection failed**: Check `.env` file credentials
3. **Permission errors**: Ensure service role key has proper permissions
4. **RLS errors**: Check Row Level Security policies

### Debug Mode

For detailed debugging, you can run individual operations:

```javascript
import { db } from '../mcp-server/src/database/index.js';

const userId = 'your-test-user-id';
const result = await db.tasks.create(userId, { title: 'Test Task', ... });
console.log(result);
```

## Integration with CI/CD

This test suite can be integrated into your CI/CD pipeline:

```yaml
# Example GitHub Actions
- name: Run Database Migration Tests
  run: node tests/database-migration-test-suite.js
```

## Notes

- Tests create real data in your Supabase database
- Use a development/test database for testing
- Test user ID is loaded from `../test-user-id.txt`
- All tests are scoped to the test user for isolation