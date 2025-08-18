# Shared Components Analysis

## Executive Summary
This document identifies components that are used by both CLI and MCP interfaces. These components contain core business logic, utilities, and infrastructure that must be retained and potentially refactored to ensure MCP-only operation after CLI removal.

## Component Categories

### 1. Task Manager Business Logic Layer
**Core business logic used by both CLI and MCP interfaces**

#### Task Manager Module Directory (`scripts/modules/task-manager/`)
**25 business logic files that implement core task management functionality**

##### Task Operations
- **`add-task.js`** - Task creation business logic
  - Used by: CLI commands.js + MCP add-task tool
  - **Action: Retain** - Core business logic

- **`add-subtask.js`** - Subtask creation business logic
  - Used by: CLI commands.js + MCP add-subtask tool
  - **Action: Retain** - Core business logic

- **`remove-task.js`** - Task deletion business logic
  - Used by: CLI commands.js + MCP remove-task tool
  - **Action: Retain** - Core business logic

- **`remove-subtask.js`** - Subtask deletion business logic
  - Used by: CLI commands.js + MCP remove-subtask tool
  - **Action: Retain** - Core business logic

- **`update-task-by-id.js`** - Task update business logic
  - Used by: CLI commands.js + MCP update-task tool
  - **Action: Retain** - Core business logic

- **`update-subtask-by-id.js`** - Subtask update business logic
  - Used by: CLI commands.js + MCP update-subtask tool
  - **Action: Retain** - Core business logic

- **`move-task.js`** - Task reorganization business logic
  - Used by: CLI commands.js + MCP move-task tool
  - **Action: Retain** - Core business logic

- **`set-task-status.js`** - Task status management business logic
  - Used by: CLI commands.js + MCP set-task-status tool
  - **Action: Retain** - Core business logic

##### Task Analysis and Expansion
- **`expand-task.js`** - Task expansion business logic
  - Used by: CLI commands.js + MCP expand-task tool
  - **Action: Retain** - Core business logic

- **`expand-all-tasks.js`** - Bulk task expansion business logic
  - Used by: CLI commands.js + MCP expand-all tool
  - **Action: Retain** - Core business logic

- **`analyze-task-complexity.js`** - Complexity analysis business logic
  - Used by: CLI commands.js + MCP analyze tool
  - **Action: Retain** - Core business logic

- **`clear-subtasks.js`** - Subtask clearing business logic
  - Used by: CLI commands.js + MCP clear-subtasks tool
  - **Action: Retain** - Core business logic

##### Task Retrieval and Navigation
- **`list-tasks.js`** - Task listing business logic
  - Used by: CLI commands.js + MCP get-tasks tool
  - **Action: Retain** - Core business logic

- **`find-next-task.js`** - Next task identification business logic
  - Used by: CLI commands.js + MCP next-task tool
  - **Action: Retain** - Core business logic

- **`task-exists.js`** - Task existence validation business logic
  - Used by: CLI commands.js + MCP validation
  - **Action: Retain** - Core business logic

##### Task Generation and Processing
- **`generate-task-files.js`** - Task file generation business logic
  - Used by: CLI commands.js + MCP generate tool
  - **Action: Retain** - Core business logic

- **`parse-prd.js`** - PRD parsing business logic
  - Used by: CLI commands.js + MCP parse-prd tool
  - **Action: Retain** - Core business logic

- **`research.js`** - Task research business logic
  - Used by: CLI commands.js + MCP research tool
  - **Action: Retain** - Core business logic

##### Configuration and Settings
- **`models.js`** - AI model management business logic
  - Used by: CLI commands.js + MCP models tool
  - **Action: Retain** - Core business logic

- **`response-language.js`** - Language configuration business logic
  - Used by: CLI commands.js + MCP response-language tool
  - **Action: Retain** - Core business logic

##### Scope Management
- **`scope-adjustment.js`** - Task scope management business logic
  - Used by: CLI commands.js + MCP scope-up/scope-down tools
  - **Action: Retain** - Core business logic

##### Data Management
- **`update-tasks.js`** - Bulk task update business logic
  - Used by: CLI commands.js + MCP update tool
  - **Action: Retain** - Core business logic

- **`update-single-task-status.js`** - Individual task status business logic
  - Used by: CLI commands.js + MCP set-task-status tool
  - **Action: Retain** - Core business logic

##### Tag Management
- **`tag-management.js`** - Tag operations business logic
  - Used by: CLI commands.js + MCP tag tools
  - **Action: Retain** - Core business logic

##### Migration and Maintenance
- **`migrate.js`** - Project migration business logic
  - Used by: CLI commands.js + potential MCP migration tool
  - **Action: Retain** - Core business logic

##### Dependency Management
- **`is-task-dependent.js`** - Dependency checking business logic
  - Used by: CLI commands.js + MCP dependency tools
  - **Action: Retain** - Core business logic

### 2. Shared Infrastructure Utilities
**Common utilities used across both CLI and MCP interfaces**

#### Core Utility Functions (`scripts/modules/utils.js`)
- **`readJSON()`** - JSON file reading utility
  - Used by: CLI commands + MCP direct functions
  - **Action: Retain** - Essential file operations

- **`writeJSON()`** - JSON file writing utility
  - Used by: CLI commands + MCP direct functions
  - **Action: Retain** - Essential file operations

- **`findTaskById()`** - Task search utility
  - Used by: CLI commands + MCP tools
  - **Action: Retain** - Core search functionality

- **`flattenTasksWithSubtasks()`** - Task flattening utility
  - Used by: CLI commands + MCP tools
  - **Action: Retain** - Data transformation

- **`resolveTag()`** - Tag resolution utility
  - Used by: CLI commands + MCP tools
  - **Action: Retain** - Tag management

- **`getCurrentTag()`** - Current tag retrieval utility
  - Used by: CLI commands + MCP tools
  - **Action: Retain** - Tag management

- **Logging utilities** - Silent mode management
  - Used by: CLI commands + MCP operations
  - **Action: Retain** - Essential logging

#### Context and Search Utilities
- **`scripts/modules/utils/contextGatherer.js`** - Context aggregation
  - Used by: CLI research + MCP research tool
  - **Action: Retain** - Core functionality

- **`scripts/modules/utils/fuzzyTaskSearch.js`** - Task search
  - Used by: CLI search + MCP search functionality
  - **Action: Retain** - Core search

- **`scripts/modules/utils/git-utils.js`** - Git operations
  - Used by: CLI commands + MCP git operations
  - **Action: Retain** - Version control integration

### 3. Configuration and Constants
**Shared configuration used by both interfaces**

#### Constants Directory (`src/constants/`)
- **`commands.js`** - Command definitions
  - Used by: CLI command mapping + MCP tool validation
  - **Action: Review and Retain** - May need CLI command removal

- **`paths.js`** - Path constants
  - Used by: CLI file operations + MCP file operations
  - **Action: Retain** - Essential path management

- **`profiles.js`** - Profile configurations
  - Used by: CLI profile management + MCP profile tools
  - **Action: Retain** - Configuration management

- **`providers.js`** - AI provider configurations
  - Used by: CLI provider setup + MCP provider management
  - **Action: Retain** - AI integration

- **`task-status.js`** - Task status definitions
  - Used by: CLI status management + MCP status tools
  - **Action: Retain** - Core data model

- **`task-priority.js`** - Task priority definitions
  - Used by: CLI priority management + MCP priority tools
  - **Action: Retain** - Core data model

- **`rules-actions.js`** - Rules and actions definitions
  - Used by: CLI rules + MCP rules tool
  - **Action: Retain** - Business logic

#### Source Utilities (`src/utils/`)
- **`path-utils.js`** - Path manipulation utilities
  - Used by: CLI path operations + MCP path operations
  - **Action: Retain** - Essential utilities

- **`logger-utils.js`** - Logging utilities
  - Used by: CLI logging + MCP logging
  - **Action: Retain** - Essential logging

- **`getVersion.js`** - Version information
  - Used by: CLI version command + MCP version info
  - **Action: Retain** - Metadata

### 4. AI Provider Infrastructure
**AI service integration used by both interfaces**

#### AI Providers Directory (`src/ai-providers/`)
- **`base-provider.js`** - Base provider abstraction
  - Used by: CLI AI operations + MCP AI operations
  - **Action: Retain** - Core AI integration

- **`anthropic.js`** - Anthropic/Claude integration
  - Used by: CLI Claude operations + MCP Claude operations
  - **Action: Retain** - Primary AI provider

- **All other providers** (OpenAI, Google, etc.)
  - Used by: CLI multi-provider support + MCP multi-provider support
  - **Action: Retain** - AI provider choice

#### Custom SDK Components
- **`src/ai-providers/custom-sdk/`** - Custom AI SDK
  - Used by: CLI AI operations + MCP AI operations
  - **Action: Retain** - AI integration layer

### 5. Profile Management
**Configuration profiles used by both interfaces**

#### Profiles Directory (`src/profiles/`)
- **All profile files** (claude.js, cursor.js, etc.)
  - Used by: CLI profile switching + MCP profile management
  - **Action: Retain** - Configuration management

### 6. Data Models and Schemas
**Shared data structures and validation**

#### Task Data Models
- Task structure definitions
- Subtask schemas
- Dependency models
- Tag structures

#### Validation Schemas
- Parameter validation
- Response schemas
- Configuration validation

## Usage Patterns Analysis

### CLI Usage Pattern
```javascript
// CLI imports shared components
import { addTask, listTasks } from './task-manager.js';
import { readJSON, writeJSON } from './utils.js';

// CLI uses components for command implementation
```

### MCP Usage Pattern
```javascript
// MCP imports same shared components
import { addTaskDirect } from '../core/task-master-core.js';
// which internally uses the same business logic
```

### Dependency Flow
```
CLI Commands → Shared Business Logic ← MCP Direct Functions
     ↓                    ↓                       ↓
     → Shared Utilities ←                         
```

## Retention Strategy

### Critical Shared Components
1. **All task manager business logic** - Core functionality
2. **Shared utilities** - Essential operations
3. **Configuration and constants** - System definitions
4. **AI provider infrastructure** - Service integration
5. **Profile management** - Configuration profiles

### Refactoring Requirements
1. **Remove CLI-specific imports** from shared components
2. **Consolidate duplicate functionality** between CLI and MCP paths
3. **Ensure MCP-only operation** of shared components
4. **Update import paths** for MCP-only structure

## Risk Assessment

### Low Risk Components
- Pure business logic functions
- Data manipulation utilities
- Configuration constants
- AI provider integrations

### Medium Risk Components
- Components with CLI-specific code paths
- Utilities with CLI formatting
- Configuration files with CLI commands

### High Risk Components
- Components importing CLI-specific libraries
- Mixed CLI/MCP logic in single files
- Shared components with console output

## Verification Strategy

### Dependency Verification
```bash
# Check for CLI-specific imports in shared components
grep -r "commander\|inquirer\|chalk\|boxen" scripts/modules/task-manager/
grep -r "commander\|inquirer\|chalk\|boxen" src/
```

### Functionality Verification
1. **Test each shared component** via MCP interface only
2. **Verify no CLI dependencies** remain in shared code
3. **Ensure complete functionality** through MCP tools

## Recommendation

**Retain all shared components with selective refactoring** - The shared components contain essential business logic that must be preserved. However, they may need refactoring to:

1. **Remove CLI-specific code paths** 
2. **Eliminate CLI library dependencies**
3. **Consolidate duplicate CLI/MCP logic**
4. **Ensure pure business logic operation**

The goal is to preserve all functionality while ensuring components operate correctly in an MCP-only environment.