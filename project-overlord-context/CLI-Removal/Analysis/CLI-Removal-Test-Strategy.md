# CLI Removal Test Strategy

## Executive Summary
This document defines a comprehensive testing strategy to validate the safe removal of CLI components from Claude Task Master while ensuring 100% preservation of MCP functionality. The strategy covers pre-removal baselines, incremental validation, post-removal verification, and cloud deployment testing.

## Testing Objectives

### Primary Objectives
1. **Validate MCP functionality preservation** - All 32 MCP tools remain fully functional
2. **Verify complete CLI removal** - No CLI dependencies or references remain
3. **Ensure cloud deployment readiness** - MCP server operates correctly in cloud environment
4. **Confirm package integrity** - Installation and distribution work correctly

### Secondary Objectives  
1. **Performance validation** - No regression in MCP response times
2. **Security verification** - Reduced attack surface achieved
3. **Documentation accuracy** - All documentation reflects MCP-only operation
4. **Developer experience** - Clear development workflow for MCP-only codebase

## Test Strategy Framework

### Test Levels
1. **Unit Tests** - Individual component validation
2. **Integration Tests** - MCP tool interaction testing
3. **System Tests** - Complete MCP server functionality
4. **Cloud Tests** - Deployment and cloud operation validation
5. **Package Tests** - Distribution and installation validation

### Test Types
1. **Functional Tests** - Feature correctness validation
2. **Regression Tests** - Ensure no functionality broken
3. **Performance Tests** - Response time and resource usage
4. **Security Tests** - Vulnerability and access control
5. **Compatibility Tests** - Cloud platform compatibility

## Pre-Removal Baseline Testing

### 1. MCP Functionality Baseline
**Objective:** Document current MCP behavior for comparison

#### Test Script: `test-mcp-baseline.js`
```javascript
#!/usr/bin/env node

import { spawn } from 'child_process';
import fetch from 'node-fetch';

const MCP_TOOLS = [
    'list-tasks', 'get-task', 'add-task', 'remove-task',
    'update-task', 'set-task-status', 'next-task',
    'expand-task', 'expand-all', 'generate', 'research',
    'analyze', 'parse-prd', 'add-subtask', 'remove-subtask',
    'update-subtask', 'clear-subtasks', 'move-task',
    'add-dependency', 'remove-dependency', 'validate-dependencies',
    'fix-dependencies', 'add-tag', 'list-tags', 'copy-tag',
    'rename-tag', 'delete-tag', 'use-tag', 'scope-up',
    'scope-down', 'models', 'rules', 'response-language'
];

async function testMCPTool(toolName) {
    try {
        const response = await fetch(`http://localhost:3000/tools/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ /* test parameters */ })
        });
        
        return {
            tool: toolName,
            status: response.status,
            success: response.ok,
            responseTime: response.headers.get('x-response-time'),
            error: response.ok ? null : await response.text()
        };
    } catch (error) {
        return {
            tool: toolName,
            status: 'ERROR',
            success: false,
            error: error.message
        };
    }
}

async function runBaselineTests() {
    console.log('Starting MCP baseline tests...');
    
    const results = [];
    for (const tool of MCP_TOOLS) {
        const result = await testMCPTool(tool);
        results.push(result);
        console.log(`${tool}: ${result.success ? 'PASS' : 'FAIL'}`);
    }
    
    // Save baseline results
    fs.writeFileSync('baseline-results.json', JSON.stringify(results, null, 2));
    console.log('Baseline testing completed');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runBaselineTests();
}
```

#### Execution
```bash
# Start MCP server
npm run mcp-server &
MCP_PID=$!

# Run baseline tests
node test-mcp-baseline.js

# Stop server
kill $MCP_PID

# Review results
cat baseline-results.json | jq '.[] | select(.success == false)'
```

### 2. Dependency Analysis Baseline
**Objective:** Document current dependency structure

```bash
# Document current dependencies
npm list --depth=0 > dependencies-before.txt
npm list --prod --depth=0 > prod-dependencies-before.txt

# Analyze bundle size
du -sh node_modules/ > bundle-size-before.txt

# Check for CLI dependencies
npm list | grep -E "(commander|inquirer|chalk|boxen|ora)" > cli-deps-before.txt
```

### 3. Package Structure Baseline
**Objective:** Document current package composition

```bash
# Document file structure
find . -type f -name "*.js" | grep -v node_modules > files-before.txt

# Package composition
npm pack --dry-run > package-contents-before.txt

# Binary entries
node -e "console.log(JSON.stringify(require('./package.json').bin, null, 2))" > bins-before.json
```

## Incremental Testing During Removal

### Phase-by-Phase Validation
**Objective:** Test after each removal phase to catch issues early

#### After Phase 2: Package Configuration Cleanup
```bash
# Test MCP server still starts
npm run mcp-server &
MCP_PID=$!

# Quick functionality test
curl -X POST http://localhost:3000/tools/list-tasks
curl -X POST http://localhost:3000/tools/get-tasks

kill $MCP_PID

# Verify CLI dependencies removed
npm list | grep -E "(commander|inquirer|chalk|boxen|ora)" | wc -l
# Should return 0
```

#### After Phase 3: CLI File Removal  
```bash
# Verify removed files don't exist
test ! -f index.js && echo "index.js removed" || echo "ERROR: index.js still exists"
test ! -d bin/ && echo "bin/ removed" || echo "ERROR: bin/ still exists"
test ! -f scripts/dev.js && echo "dev.js removed" || echo "ERROR: dev.js still exists"

# Test MCP functionality unaffected
node test-mcp-baseline.js
diff baseline-results.json current-results.json
```

#### After Phase 4: Hybrid Component Refactoring
```bash
# Test refactored utilities work
node -e "
const utils = require('./scripts/modules/utils.js');
console.log('readJSON works:', typeof utils.readJSON === 'function');
console.log('writeJSON works:', typeof utils.writeJSON === 'function');
"

# Test business logic intact
node -e "
const taskManager = require('./scripts/modules/task-manager.js');
console.log('addTask works:', typeof taskManager.addTask === 'function');
console.log('listTasks works:', typeof taskManager.listTasks === 'function');
"

# Full MCP test suite
node test-mcp-comprehensive.js
```

### Import Path Validation
**Objective:** Ensure no broken imports after refactoring

#### Test Script: `validate-imports.js`
```javascript
#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

async function validateImports(directory) {
    const files = fs.readdirSync(directory, { recursive: true })
        .filter(file => file.endsWith('.js'));
    
    const results = [];
    
    for (const file of files) {
        const filePath = path.join(directory, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Extract import statements
        const imports = content.match(/import.*from\s+['"]([^'"]+)['"]/g) || [];
        
        for (const importLine of imports) {
            const modulePath = importLine.match(/from\s+['"]([^'"]+)['"]/)[1];
            
            // Check if import path exists
            try {
                await import(path.resolve(path.dirname(filePath), modulePath));
                results.push({ file, import: modulePath, status: 'OK' });
            } catch (error) {
                results.push({ file, import: modulePath, status: 'ERROR', error: error.message });
            }
        }
    }
    
    return results;
}

// Validate all MCP components
const mcpResults = await validateImports('mcp-server/');
const sharedResults = await validateImports('scripts/modules/');

const errors = [...mcpResults, ...sharedResults].filter(r => r.status === 'ERROR');
if (errors.length > 0) {
    console.error('Import validation errors:', errors);
    process.exit(1);
} else {
    console.log('All imports valid');
}
```

## Post-Removal Verification Testing

### 1. Complete MCP Functionality Test
**Objective:** Verify all MCP tools work correctly after CLI removal

#### Comprehensive MCP Test Suite: `test-mcp-comprehensive.js`
```javascript
#!/usr/bin/env node

import { testMCPTool } from './test-mcp-baseline.js';

const COMPREHENSIVE_TESTS = [
    // Task Management Tests
    {
        tool: 'add-task',
        params: { title: 'Test Task', description: 'CLI removal test' },
        validate: (response) => response.task && response.task.id
    },
    {
        tool: 'list-tasks',
        params: {},
        validate: (response) => Array.isArray(response.tasks)
    },
    {
        tool: 'get-task',
        params: { id: '1' },
        validate: (response) => response.task || response.error
    },
    
    // Analysis Tests
    {
        tool: 'analyze',
        params: { projectRoot: './test-project' },
        validate: (response) => response.analysis || response.error
    },
    
    // Generation Tests
    {
        tool: 'generate',
        params: { outputDir: './test-output' },
        validate: (response) => response.generated || response.error
    },
    
    // Research Tests
    {
        tool: 'research',
        params: { query: 'test research query' },
        validate: (response) => response.research || response.error
    }
];

async function runComprehensiveTests() {
    console.log('Running comprehensive MCP tests...');
    
    const results = [];
    let passCount = 0;
    let failCount = 0;
    
    for (const test of COMPREHENSIVE_TESTS) {
        const result = await testMCPTool(test.tool, test.params);
        const isValid = test.validate(result.response);
        
        results.push({
            ...result,
            validation: isValid,
            testPassed: result.success && isValid
        });
        
        if (result.success && isValid) {
            passCount++;
            console.log(`✓ ${test.tool}: PASS`);
        } else {
            failCount++;
            console.log(`✗ ${test.tool}: FAIL - ${result.error || 'Validation failed'}`);
        }
    }
    
    console.log(`\nResults: ${passCount} passed, ${failCount} failed`);
    
    // Save detailed results
    fs.writeFileSync('comprehensive-test-results.json', JSON.stringify(results, null, 2));
    
    return failCount === 0;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const success = await runComprehensiveTests();
    process.exit(success ? 0 : 1);
}
```

### 2. Dependency Cleanliness Verification
**Objective:** Confirm no CLI dependencies remain

#### Test Script: `verify-clean-dependencies.js`
```javascript
#!/usr/bin/env node

import fs from 'fs';
import { execSync } from 'child_process';

const CLI_DEPENDENCIES = [
    'commander', 'inquirer', 'chalk', 'boxen', 'ora',
    'figlet', 'cli-highlight', 'cli-table3', 'gradient-string'
];

function checkPackageJson() {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.optionalDependencies
    };
    
    const foundCliDeps = CLI_DEPENDENCIES.filter(dep => dep in allDeps);
    
    if (foundCliDeps.length > 0) {
        console.error('ERROR: CLI dependencies found in package.json:', foundCliDeps);
        return false;
    }
    
    console.log('✓ No CLI dependencies in package.json');
    return true;
}

function checkNodeModules() {
    try {
        const installedPackages = execSync('npm list --depth=0', { encoding: 'utf8' });
        const foundCliDeps = CLI_DEPENDENCIES.filter(dep => 
            installedPackages.includes(dep)
        );
        
        if (foundCliDeps.length > 0) {
            console.error('ERROR: CLI dependencies found in node_modules:', foundCliDeps);
            return false;
        }
        
        console.log('✓ No CLI dependencies in node_modules');
        return true;
    } catch (error) {
        console.error('Error checking node_modules:', error.message);
        return false;
    }
}

function checkSourceCode() {
    try {
        const cliImports = execSync(
            `find . -name "*.js" -not -path "./node_modules/*" -exec grep -l "commander\\|inquirer\\|chalk\\|boxen\\|ora" {} \\;`,
            { encoding: 'utf8' }
        ).trim();
        
        if (cliImports) {
            console.error('ERROR: CLI imports found in source code:', cliImports.split('\n'));
            return false;
        }
        
        console.log('✓ No CLI imports in source code');
        return true;
    } catch (error) {
        // grep returns non-zero when no matches found, which is what we want
        if (error.status === 1) {
            console.log('✓ No CLI imports in source code');
            return true;
        }
        console.error('Error checking source code:', error.message);
        return false;
    }
}

// Run all checks
const checks = [
    checkPackageJson(),
    checkNodeModules(),
    checkSourceCode()
];

const allPassed = checks.every(check => check);
console.log(allPassed ? '✓ All dependency checks passed' : '✗ Some dependency checks failed');
process.exit(allPassed ? 0 : 1);
```

### 3. Package Integrity Testing
**Objective:** Verify package installs and works correctly

```bash
# Test package creation
npm pack

# Test installation in clean environment
mkdir test-install && cd test-install
npm init -y
npm install ../task-master-ai-*.tgz

# Test MCP server can start
npx task-master-mcp &
MCP_PID=$!

# Test basic functionality
curl -X POST http://localhost:3000/tools/list-tasks

kill $MCP_PID
cd .. && rm -rf test-install
```

## Cloud Deployment Testing

### 1. Container Testing
**Objective:** Verify MCP server works in containerized environment

#### Dockerfile for Testing
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY mcp-server/ ./mcp-server/
COPY src/ ./src/
COPY scripts/modules/task-manager/ ./scripts/modules/task-manager/
COPY scripts/modules/utils.js ./scripts/modules/utils.js

EXPOSE 3000

CMD ["node", "mcp-server/server.js"]
```

#### Container Test Script
```bash
#!/bin/bash

echo "Building Docker image..."
docker build -t task-master-mcp-test .

echo "Starting container..."
docker run -d -p 3000:3000 --name mcp-test task-master-mcp-test

# Wait for startup
sleep 10

echo "Testing container functionality..."
curl -X POST http://localhost:3000/tools/list-tasks
curl -X POST http://localhost:3000/tools/get-tasks

echo "Cleaning up..."
docker stop mcp-test
docker rm mcp-test
docker rmi task-master-mcp-test

echo "Container test completed"
```

### 2. Cloud Platform Testing
**Objective:** Verify deployment on target cloud platforms

#### AWS Lambda Test
```javascript
// lambda-test.js
import { handler } from './mcp-server/lambda-handler.js';

export async function testLambdaDeployment() {
    const event = {
        httpMethod: 'POST',
        path: '/tools/list-tasks',
        body: JSON.stringify({})
    };
    
    const result = await handler(event);
    console.log('Lambda test result:', result);
    
    return result.statusCode === 200;
}
```

#### Google Cloud Functions Test
```javascript
// gcf-test.js
import { mcpHandler } from './mcp-server/gcf-handler.js';

export async function testGCFDeployment() {
    const req = {
        method: 'POST',
        path: '/tools/list-tasks',
        body: {}
    };
    
    const res = {
        status: code => ({ json: data => ({ statusCode: code, body: data }) })
    };
    
    const result = await mcpHandler(req, res);
    console.log('GCF test result:', result);
    
    return result.statusCode === 200;
}
```

## Performance Testing

### 1. Response Time Testing
**Objective:** Ensure no performance regression after CLI removal

#### Performance Test Script: `test-performance.js`
```javascript
#!/usr/bin/env node

import { performance } from 'perf_hooks';

async function measureResponseTime(toolName, iterations = 10) {
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        
        const response = await fetch(`http://localhost:3000/tools/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        
        const end = performance.now();
        times.push(end - start);
    }
    
    return {
        tool: toolName,
        avg: times.reduce((a, b) => a + b) / times.length,
        min: Math.min(...times),
        max: Math.max(...times),
        median: times.sort()[Math.floor(times.length / 2)]
    };
}

async function runPerformanceTests() {
    const tools = ['list-tasks', 'get-tasks', 'add-task', 'analyze'];
    const results = [];
    
    for (const tool of tools) {
        const result = await measureResponseTime(tool);
        results.push(result);
        console.log(`${tool}: avg ${result.avg.toFixed(2)}ms`);
    }
    
    // Compare with baseline if available
    if (fs.existsSync('baseline-performance.json')) {
        const baseline = JSON.parse(fs.readFileSync('baseline-performance.json', 'utf8'));
        console.log('\nPerformance comparison:');
        
        results.forEach(result => {
            const baselineResult = baseline.find(b => b.tool === result.tool);
            if (baselineResult) {
                const diff = result.avg - baselineResult.avg;
                const pctChange = (diff / baselineResult.avg) * 100;
                console.log(`${result.tool}: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}ms (${pctChange.toFixed(1)}%)`);
            }
        });
    }
    
    fs.writeFileSync('performance-results.json', JSON.stringify(results, null, 2));
}
```

### 2. Memory Usage Testing
**Objective:** Verify memory usage improvement

```bash
# Test memory usage
npm run mcp-server &
MCP_PID=$!

# Monitor memory usage
ps -o pid,vsz,rss,comm $MCP_PID
top -p $MCP_PID -b -n 10 | grep $MCP_PID > memory-usage.log

kill $MCP_PID
```

## Automated Test Suite

### Test Runner Script: `run-all-tests.sh`
```bash
#!/bin/bash

set -e

echo "=== CLI Removal Test Suite ==="
echo "Started: $(date)"

# Pre-flight checks
echo "1. Checking environment..."
node --version
npm --version

# Start MCP server
echo "2. Starting MCP server..."
npm run mcp-server &
MCP_PID=$!
sleep 5

# Wait for server to be ready
echo "3. Waiting for server ready..."
for i in {1..30}; do
    if curl -s http://localhost:3000/health > /dev/null; then
        echo "Server ready"
        break
    fi
    sleep 1
done

# Run test suites
echo "4. Running dependency verification..."
node verify-clean-dependencies.js

echo "5. Running import validation..."
node validate-imports.js

echo "6. Running comprehensive MCP tests..."
node test-mcp-comprehensive.js

echo "7. Running performance tests..."
node test-performance.js

echo "8. Running package integrity tests..."
npm pack > /dev/null
echo "Package created successfully"

# Cleanup
echo "9. Cleaning up..."
kill $MCP_PID 2>/dev/null || true
rm -f task-master-ai-*.tgz

echo "=== Test Suite Completed ==="
echo "Finished: $(date)"
echo "All tests passed!"
```

## Test Data Management

### Test Data Setup
```bash
# Create test project structure
mkdir -p test-data/project1/.taskmaster/tasks
echo '{"tasks": [{"id": "1", "title": "Test Task"}]}' > test-data/project1/.taskmaster/tasks/tasks.json

# Create test PRD
echo "# Test PRD
## Features
1. User authentication
2. Data processing" > test-data/test-prd.md
```

### Test Data Cleanup
```bash
# Cleanup test artifacts
rm -rf test-data/
rm -f baseline-*.json
rm -f performance-*.json
rm -f comprehensive-test-*.json
rm -f task-master-ai-*.tgz
```

## Continuous Integration Integration

### GitHub Actions Workflow
```yaml
name: CLI Removal Tests

on: [push, pull_request]

jobs:
  test-cli-removal:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run CLI removal test suite
      run: ./run-all-tests.sh
    
    - name: Upload test results
      uses: actions/upload-artifact@v3
      with:
        name: test-results
        path: '*-results.json'
```

## Success Criteria

### Functional Success Criteria
- [ ] All 32 MCP tools return successful responses
- [ ] No CLI dependencies found in package.json
- [ ] No CLI imports found in source code
- [ ] Package installs without errors
- [ ] MCP server starts in cloud environment

### Performance Success Criteria
- [ ] Response times within 10% of baseline
- [ ] Memory usage unchanged or reduced
- [ ] Package size reduced by at least 20MB
- [ ] Startup time unchanged or improved

### Quality Success Criteria
- [ ] All import paths resolve correctly
- [ ] No runtime errors in comprehensive tests
- [ ] Container deployment successful
- [ ] Cloud platform compatibility verified

## Reporting

### Test Report Template
```markdown
# CLI Removal Test Report

## Summary
- **Date**: [Date]
- **Version**: [Version]
- **Overall Status**: [PASS/FAIL]

## Test Results
- **MCP Functionality**: X/32 tools passed
- **Dependency Cleanliness**: [PASS/FAIL]
- **Package Integrity**: [PASS/FAIL]
- **Performance**: [PASS/FAIL]

## Issues Found
[List any issues discovered]

## Recommendations
[Recommendations for next steps]
```

## Conclusion

This comprehensive test strategy ensures safe CLI removal while preserving all MCP functionality. The multi-layered approach with baseline establishment, incremental validation, and comprehensive post-removal testing provides confidence in the migration process.

**Key Testing Principles:**
1. **Establish baselines** before making changes
2. **Test incrementally** during removal process
3. **Validate comprehensively** after completion
4. **Automate everything** for repeatability
5. **Document thoroughly** for future reference