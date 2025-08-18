# Comprehensive Dependency Analysis

## Executive Summary
This document provides a complete dependency mapping of the Claude Task Master codebase, identifying the relationships between CLI-specific, MCP-specific, shared, and hybrid components. This analysis enables safe CLI removal by understanding the complete dependency graph.

## Dependency Graph Overview

### High-Level Architecture Dependencies
```
CLI Entry Points → Shared Business Logic ← MCP Interface Layer
       ↓                    ↓                       ↓
CLI Utilities →      Shared Utilities        ← MCP Utilities
       ↓                    ↓                       ↓
       → AI Providers & Infrastructure ←
       →     Configuration & Constants    ←
```

## Component Dependency Mapping

### 1. CLI-Specific Dependencies

#### CLI Entry Point Dependencies
**`index.js` (CLI Entry Point)**
```javascript
// CLI-only dependencies
import { Command } from 'commander';           // CLI framework
import { spawn } from 'child_process';         // Process spawning

// Shared dependencies  
import { fileURLToPath } from 'url';           // Shared utility
import { dirname, resolve } from 'path';       // Shared utility

// Dependencies on:
├── scripts/init.js (CLI-specific)
├── scripts/dev.js (CLI-specific)
└── package.json (hybrid)
```

**`scripts/dev.js` (CLI Command Processor)**
```javascript
// CLI-only dependencies
import dotenv from 'dotenv';                   // Environment (shared but CLI usage)

// Dependencies on:
└── scripts/modules/commands.js (CLI-specific)
```

**`scripts/modules/commands.js` (CLI Implementation)**
```javascript
// CLI-only dependencies
import { program } from 'commander';           // CLI framework
import chalk from 'chalk';                     // Terminal colors
import boxen from 'boxen';                     // Terminal boxes
import inquirer from 'inquirer';               // Interactive prompts
import ora from 'ora';                         // CLI spinners

// Shared dependencies
import path from 'path';                       // Node.js built-in
import fs from 'fs';                          // Node.js built-in

// Dependencies on:
├── scripts/modules/utils.js (hybrid)
├── scripts/modules/task-manager.js (hybrid)
└── All task-manager/* modules (shared)
```

### 2. MCP-Specific Dependencies

#### MCP Server Dependencies
**`mcp-server/server.js` (MCP Entry Point)**
```javascript
// MCP-only dependencies
import { FastMCP } from 'fastmcp';             // MCP framework

// Dependencies on:
├── mcp-server/src/index.js (MCP-specific)
└── mcp-server/src/logger.js (MCP-specific)
```

**`mcp-server/src/index.js` (MCP Core)**
```javascript
// MCP-only dependencies
import { FastMCP } from 'fastmcp';             // MCP framework

// Dependencies on:
├── mcp-server/src/tools/index.js (MCP-specific)
├── mcp-server/src/core/task-master-core.js (MCP-specific)
└── All tools/* (MCP-specific)
```

#### MCP Tool Dependencies
**All MCP Tools (`mcp-server/src/tools/*.js`)**
```javascript
// MCP-only dependencies
import { z } from 'zod';                       // Schema validation
import { 
    handleApiResult, 
    createErrorResponse 
} from './utils.js';                           // MCP utilities

// Shared dependencies
import { findTasksPath } from '../core/utils/path-utils.js';

// Dependencies on:
├── mcp-server/src/core/task-master-core.js (MCP-specific)
├── Direct function modules (MCP-specific)
└── Shared utilities (shared)
```

#### MCP Core Implementation Dependencies
**`mcp-server/src/core/task-master-core.js`**
```javascript
// Dependencies on:
├── All direct-functions/* (MCP-specific)
├── Shared business logic modules (shared)
└── Shared utilities (shared)
```

### 3. Shared Component Dependencies

#### Task Manager Business Logic
**All modules in `scripts/modules/task-manager/`**
```javascript
// Shared dependencies (used by both CLI and MCP)
import fs from 'fs';                          // Node.js built-in
import path from 'path';                      // Node.js built-in

// Dependencies on:
├── scripts/modules/utils.js (hybrid - needs refactoring)
├── src/constants/* (shared)
├── src/ai-providers/* (shared)
└── src/utils/* (shared)

// Used by:
├── CLI commands.js
└── MCP direct functions
```

#### Core Utilities
**`scripts/modules/utils.js` (Hybrid - needs refactoring)**
```javascript
// CLI dependencies (to be removed)
import chalk from 'chalk';                     // Terminal colors

// Shared dependencies
import fs from 'fs';                          // Node.js built-in
import path from 'path';                      // Node.js built-in

// Used by:
├── CLI commands.js
├── Task manager modules
└── MCP direct functions
```

### 4. Infrastructure Dependencies

#### AI Provider Dependencies
**All modules in `src/ai-providers/`**
```javascript
// Shared AI dependencies
import { anthropic } from '@ai-sdk/anthropic'; // AI provider
import { openai } from '@ai-sdk/openai';       // AI provider

// Dependencies on:
├── src/constants/providers.js (shared)
└── Environment configuration (shared)

// Used by:
├── CLI AI operations
└── MCP AI operations
```

#### Configuration Dependencies
**All modules in `src/constants/`**
```javascript
// Pure configuration (no external dependencies)

// Used by:
├── CLI operations
├── MCP operations
├── Task manager modules
└── AI providers
```

## Critical Dependency Paths

### 1. CLI → Shared → MCP Contamination Risks
**Paths where CLI dependencies could affect MCP:**

```
CLI commands.js → utils.js (hybrid) → Task Manager → MCP Direct Functions
                                                   ↗
CLI chalk/inquirer imports could leak through shared components
```

**Mitigation:** Refactor hybrid components to remove CLI dependencies

### 2. Shared Component Independence
**Ensuring shared components work without CLI:**

```
MCP Tools → Direct Functions → Task Manager → Shared Utilities
          ↗                                 ↗
Must work without CLI dependencies
```

**Verification:** Test all shared components via MCP interface only

### 3. Configuration Dependency Chain
**Configuration flows through system:**

```
Environment → Constants → Providers → Business Logic → Interface Layer
            ↗           ↗          ↗                ↗
Must remain functional after CLI removal
```

## Package Dependency Analysis

### CLI-Specific NPM Dependencies (Safe to Remove)
```json
{
    "commander": "^11.1.0",           // CLI framework
    "inquirer": "^12.5.0",            // Interactive prompts
    "chalk": "^5.4.1",                // Terminal colors
    "boxen": "^8.0.1",                // Terminal boxes
    "ora": "^8.2.0",                  // CLI spinners
    "figlet": "^1.8.0",               // ASCII art
    "cli-highlight": "^2.1.11",       // Syntax highlighting
    "cli-table3": "^0.6.5",           // Terminal tables
    "gradient-string": "^3.0.0"       // Text effects
}
```

### MCP-Specific NPM Dependencies (Must Retain)
```json
{
    "fastmcp": "^3.5.0",              // MCP framework
    "zod": "^3.23.8",                 // Schema validation
    "express": "^4.21.2",             // HTTP server
    "cors": "^2.8.5",                 // Cross-origin support
    "helmet": "^8.1.0"                // Security middleware
}
```

### Shared NPM Dependencies (Must Retain)
```json
{
    "fuse.js": "^7.1.0",              // Fuzzy search (CLI + MCP)
    "gpt-tokens": "^1.3.14",          // Token counting (CLI + MCP)
    "dotenv": "^16.3.1",              // Environment (CLI + MCP)
    "uuid": "^11.1.0",                // Unique IDs (CLI + MCP)
    "jsonc-parser": "^3.3.1",         // JSON parsing (CLI + MCP)
    "jsonrepair": "^3.13.0",          // JSON repair (CLI + MCP)
    "lru-cache": "^10.2.0"            // Caching (CLI + MCP)
}
```

### AI Provider Dependencies (Must Retain)
```json
{
    "@ai-sdk/anthropic": "^1.2.10",   // Claude integration
    "@ai-sdk/openai": "^1.3.20",      // OpenAI integration
    "@ai-sdk/google": "^1.2.13",      // Google integration
    "ai": "^4.3.10"                   // AI SDK core
}
```

## Import Analysis by File Type

### CLI Files Import Pattern
```javascript
// CLI-specific imports
import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';

// Shared imports
import { readJSON, writeJSON } from './utils.js';
import { addTask, listTasks } from './task-manager.js';
```

### MCP Files Import Pattern
```javascript
// MCP-specific imports
import { z } from 'zod';
import { handleApiResult } from './utils.js';

// Shared imports
import { addTaskDirect } from '../core/task-master-core.js';
import { findTasksPath } from '../core/utils/path-utils.js';
```

### Shared Files Import Pattern
```javascript
// Node.js built-ins only
import fs from 'fs';
import path from 'path';

// Other shared modules
import { TASK_STATUS } from '../constants/task-status.js';
```

## Dependency Verification Commands

### Check for CLI Contamination in MCP Components
```bash
# Verify no CLI dependencies in MCP server
find mcp-server/ -name "*.js" -exec grep -l "commander\|inquirer\|chalk\|boxen\|ora" {} \;

# Should return empty result
```

### Check for CLI Contamination in Shared Components
```bash
# Check shared utilities for CLI dependencies
grep -r "commander\|inquirer\|chalk\|boxen\|ora" scripts/modules/task-manager/
grep -r "commander\|inquirer\|chalk\|boxen\|ora" src/

# Identify files needing refactoring
```

### Verify MCP-Only Functionality
```bash
# Test MCP tools without CLI dependencies
node -e "
const mcp = require('./mcp-server/src/index.js');
// Test basic functionality
"
```

## Refactoring Impact Analysis

### Files Requiring Refactoring
1. **`scripts/modules/utils.js`** - Remove CLI formatting functions
2. **`scripts/modules/task-manager.js`** - Remove CLI-specific imports
3. **`package.json`** - Remove CLI dependencies and binary entries
4. **`src/constants/commands.js`** - Remove CLI command definitions

### Files Safe to Remove Entirely
1. **`index.js`** - CLI entry point
2. **`scripts/dev.js`** - CLI command processor
3. **`scripts/modules/commands.js`** - CLI implementation
4. **`scripts/init.js`** - CLI project initialization
5. **`bin/task-master.js`** - CLI binary
6. **All CLI documentation** in `assets/claude/commands/tm/`

### Files Requiring No Changes
1. **All MCP server files** (`mcp-server/`)
2. **AI provider modules** (`src/ai-providers/`)
3. **Core constants** (`src/constants/`)
4. **Task manager business logic** (`scripts/modules/task-manager/`)
5. **Infrastructure utilities** (`src/utils/`)

## Validation Strategy

### Pre-Removal Validation
1. **Document current dependency graph**
2. **Test all MCP functionality**
3. **Identify all import paths**
4. **Map shared component usage**

### Post-Removal Validation
1. **Verify MCP server starts correctly**
2. **Test all 32 MCP tools function**
3. **Confirm no CLI dependencies remain**
4. **Validate shared components work MCP-only**

## Risk Mitigation

### High Risk Mitigation
- **Incremental removal** - Remove CLI components one at a time
- **Continuous testing** - Test MCP after each removal
- **Backup strategy** - Maintain rollback capability

### Medium Risk Mitigation
- **Shared component isolation** - Ensure no CLI dependency leakage
- **Import path verification** - Check all import statements
- **Functionality preservation** - Verify business logic intact

### Low Risk Mitigation
- **Configuration cleanup** - Remove CLI-specific settings
- **Documentation updates** - Update remaining documentation
- **Package optimization** - Clean up unnecessary dependencies

## Recommendation

**The dependency analysis reveals a clean separation between CLI and MCP components with well-defined shared boundaries.** CLI removal is safe to proceed with the following approach:

1. **Remove CLI-specific components entirely** (zero MCP dependencies)
2. **Refactor hybrid components** to remove CLI contamination
3. **Retain all shared components** with minimal modifications
4. **Preserve all MCP components** without changes

The dependency graph shows that MCP functionality is completely independent of CLI components, making this a low-risk removal process.