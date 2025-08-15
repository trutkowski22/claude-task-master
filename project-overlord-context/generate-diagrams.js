#!/usr/bin/env node
/*
  Generator: Recursive Code Analysis with Layered Architecture Mermaid Diagrams
  - Reads configuration from Analysis-Mapping-Instructions.md (embedded below)
  - Scans target directory, applies include/exclude rules
  - Categorizes files into layers (Interface, Core, Shared)
  - Extracts: imports, dependencies (simple heuristics), functions defined, exports, JSDoc @param, const declarations, env vars, and builds a basic execution flow
  - Writes per-file Mermaid .mmd diagrams
  - Writes per-layer master diagrams and one system overview
  - Writes analysis_summary.md
*/

const fs = require('fs');
const path = require('path');

// ---------- Configuration (derived from Analysis-Mapping-Instructions.md) ----------
const WORKSPACE_ROOT = process.cwd();
const TARGET_DIRECTORY = path.join(WORKSPACE_ROOT, 'claude-task-master');

const OUTPUT_DIR_SHARED = path.join(WORKSPACE_ROOT, 'project-overlord-context', 'Mermaid-Diagrams', 'Shared-Infrastructure-Layer');
const OUTPUT_DIR_CORE = path.join(WORKSPACE_ROOT, 'project-overlord-context', 'Mermaid-Diagrams', 'Core-Implementation-Layer');
const OUTPUT_DIR_INTERFACE = path.join(WORKSPACE_ROOT, 'project-overlord-context', 'Mermaid-Diagrams', 'Interface-Layer');
const OUTPUT_DIR_MASTER = path.join(WORKSPACE_ROOT, 'project-overlord-context', 'Mermaid-Diagrams', 'Master-Diagrams');

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', '.pytest_cache', '.vscode', '.cursor', 'assets', 'docs', 'context', 'bin',
  path.join('claude-task-master', 'mcp-server', 'src', 'core', '__tests__'),
  '.taskmaster', '.claude', path.join('claude-task-master', 'assets')
]);

// Files to exclude by name or pattern
const EXCLUDED_FILES = [
  '.DS_Store', '.gitignore', 'package-lock.json', 'yarn.lock',
  // Exclude markdown and JSON (except we allow some core JSON - handled below)
  // We'll skip all .md and .json here and add specific JSON includes later if needed
];

// Include only these file extensions
const INCLUDED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go']);

// Additional JSON allowlist (rarely needed here). Keep empty to follow spec strictly.
const JSON_ALLOWLIST_RELATIVE = new Set([
  // Example: 'claude-task-master/claude-task-master/src/prompts/schemas/parameter.schema.json'
]);

// ---------- Helpers ----------
function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isExcludedDir(absPath) {
  // Determine relative path from TARGET_DIRECTORY and check exclusion tokens
  const rel = path.relative(TARGET_DIRECTORY, absPath);
  if (!rel || rel.startsWith('..')) return false; // outside target
  const parts = rel.split(path.sep);
  // Check cumulative paths too
  let acc = '';
  for (const part of parts) {
    acc = acc ? path.join(acc, part) : part;
    if (EXCLUDED_DIRECTORIES.has(part) || EXCLUDED_DIRECTORIES.has(acc)) return true;
  }
  return false;
}

function shouldSkipFile(filePath) {
  const base = path.basename(filePath);
  if (EXCLUDED_FILES.includes(base)) return true;
  const ext = path.extname(base).toLowerCase();
  if (ext === '.md') return true;
  if (ext === '.json') {
    // Allow only if explicitly allowlisted
    const relFromRoot = normalizeToPosix(path.relative(WORKSPACE_ROOT, filePath));
    return !JSON_ALLOWLIST_RELATIVE.has(relFromRoot);
  }
  if (!INCLUDED_EXTENSIONS.has(ext)) return true;
  return false;
}

function normalizeToPosix(p) {
  return p.replace(/\\/g, '/');
}

// Convert an absolute path to the normalized "/project/..."-style display used in diagrams
function toProjectDisplayPath(absPath) {
  const rel = normalizeToPosix(path.relative(WORKSPACE_ROOT, absPath));
  return '/' + rel;
}

// Determine architectural layer by file path
function determineLayer(absPath) {
  const rel = normalizeToPosix(path.relative(TARGET_DIRECTORY, absPath));
  // Interface layer: MCP tools and CLI commands (bin excluded by spec)
  if (rel.startsWith('mcp-server/src/tools/')) return 'interface';
  if (rel === 'scripts/modules/commands.js') return 'interface';

  // Core implementation: direct-functions, core task logic
  if (rel.startsWith('mcp-server/src/core/direct-functions/')) return 'core';
  if (rel.startsWith('scripts/modules/task-manager/')) return 'core';
  if (rel.startsWith('scripts/modules/') && !rel.includes('/utils/')) return 'core';

  // Shared infrastructure: utils, constants, providers, prompts, profiles, logger, core utils
  if (rel.startsWith('src/constants/')) return 'shared';
  if (rel.startsWith('src/utils/')) return 'shared';
  if (rel.startsWith('src/ai-providers/')) return 'shared';
  if (rel.startsWith('src/provider-registry/')) return 'shared';
  if (rel.startsWith('src/prompts/')) return 'shared';
  if (rel.startsWith('src/profiles/')) return 'shared';
  if (rel.startsWith('mcp-server/src/core/utils/')) return 'shared';
  if (rel.startsWith('mcp-server/src/logger.js')) return 'shared';
  if (rel.startsWith('mcp-server/src/providers/')) return 'shared';
  if (rel.startsWith('scripts/modules/utils/')) return 'shared';
  if (rel.startsWith('mcp-server/src/core/context-manager.js')) return 'shared';
  if (rel.startsWith('mcp-server/src/core/task-master-core.js')) return 'shared';

  // Default: place in shared to keep coverage
  return 'shared';
}

// ---------- Extraction Utilities (lightweight heuristics) ----------
function extractImports(content, absPath) {
  const imports = [];
  const lines = content.split(/\r?\n/);
  const importRegex = /import\s+[^'"\n]+from\s+['"]([^'"]+)['"];?/;
  const importSideRegex = /import\s+['"]([^'"]+)['"];?/;
  const requireRegex = /(?:const|let|var)\s+\w+\s*=\s*require\(['"]([^'"]+)['"]\)/;
  const requireDestrRegex = /(?:const|let|var)\s*\{[^}]+\}\s*=\s*require\(['"]([^'"]+)['"]\)/;

  for (const line of lines) {
    let m = line.match(importRegex) || line.match(importSideRegex) || line.match(requireRegex) || line.match(requireDestrRegex);
    if (m) {
      const spec = m[1];
      const fromPath = resolveImportPath(absPath, spec);
      imports.push({ spec, from: fromPath });
    }
  }
  return imports;
}

function resolveImportPath(fromFileAbs, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    // external package
    return spec;
  }
  // resolve relative to fromFileAbs
  const baseDir = path.dirname(fromFileAbs);
  let resolved = path.resolve(baseDir, spec);
  // try to append extensions if missing
  const candidates = [resolved, resolved + '.js', resolved + '.ts', resolved + '.jsx', resolved + '.tsx', path.join(resolved, 'index.js'), path.join(resolved, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return toProjectDisplayPath(c);
    }
  }
  // fallback to normalized candidate
  return toProjectDisplayPath(resolved);
}

function extractFunctionsDefined(content) {
  const functions = new Set();
  // function declarations
  const funcDecl = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = funcDecl.exec(content))) functions.add(m[1]);
  // exported function declarations (redundant but safe)
  const exportFunc = /export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = exportFunc.exec(content))) functions.add(m[1]);
  // const name = (...) =>
  const arrowConst = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  while ((m = arrowConst.exec(content))) functions.add(m[1]);
  // const name = function
  const funcExpr = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?function\s*\(/g;
  while ((m = funcExpr.exec(content))) functions.add(m[1]);
  return Array.from(functions);
}

function extractExports(content) {
  const exportsFound = new Set();
  // ES exports
  const exportNamed = /export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m;
  while ((m = exportNamed.exec(content))) exportsFound.add(m[1]);
  const exportList = /export\s*\{([^}]+)\}/g;
  while ((m = exportList.exec(content))) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    names.forEach(n => exportsFound.add(n));
  }
  const exportDefault = /export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = exportDefault.exec(content))) exportsFound.add(m[1]);
  // CommonJS
  const moduleExports = /module\.exports\s*=\s*\{([^}]+)\}/g;
  while ((m = moduleExports.exec(content))) {
    const names = m[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
    names.forEach(n => exportsFound.add(n));
  }
  const moduleExportProp = /exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*/g;
  while ((m = moduleExportProp.exec(content))) exportsFound.add(m[1]);
  return Array.from(exportsFound);
}

function extractJsDocParams(content) {
  const params = [];
  const blockRegex = /\/\*\*([\s\S]*?)\*\//g;
  let m;
  while ((m = blockRegex.exec(content))) {
    const block = m[1];
    const paramRegex = /@param\s+\{([^}]+)\}\s+([A-Za-z0-9_.$\[\]]+)\s*-\s*([^\n\r]*)/g;
    let pm;
    while ((pm = paramRegex.exec(block))) {
      params.push({ type: pm[1].trim(), name: pm[2].trim(), description: pm[3].trim() });
    }
  }
  return params;
}

function extractConstants(content) {
  const constants = [];
  const constRegex = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;\n\r]+)/g;
  let m;
  while ((m = constRegex.exec(content))) {
    const name = m[1];
    const valueRaw = m[2].trim();
    const value = valueRaw.length > 120 ? valueRaw.slice(0, 117) + '...' : valueRaw;
    constants.push({ name, value });
  }
  return constants;
}

function extractEnvVars(content) {
  const env = new Set();
  const envRegex = /process\.env\.([A-Z0-9_]+)/g;
  let m;
  while ((m = envRegex.exec(content))) env.add(m[1]);
  return Array.from(env);
}

function buildExecutionFlow(imports, functions, exportsArr) {
  const flow = [];
  if (imports.length) flow.push('Identify and load dependencies and modules');
  if (functions.length) flow.push('Define functions and core logic for this module');
  if (exportsArr.length) flow.push('Expose public API via exports');
  if (!flow.length) flow.push('Process file-level statements');
  return flow;
}

function renderFileDiagram(fileAbsPath, analysis) {
  const fileDisplay = path.basename(fileAbsPath);
  const sections = [];
  const lines = [];
  lines.push('```mermaid');
  lines.push('flowchart TB');

  if (analysis.imports.length) {
    sections.push('Imports');
    lines.push('    subgraph Imports["Imports"]');
    analysis.imports.forEach((imp, idx) => {
      const i = idx + 1;
      const from = imp.from.startsWith('/') ? imp.from : imp.from; // external packages kept as-is
      lines.push(`        I${i}["IMPORT: ${escapeLabel(imp.spec)}, FROM: ${escapeLabel(from)}"]`);
    });
    lines.push('    end');
  }

  if (analysis.dependencies.length) {
    sections.push('Dependencies');
    lines.push('    subgraph Dependencies["Dependencies"]');
    analysis.dependencies.forEach((dep, idx) => {
      const d = idx + 1;
      lines.push(`        D${d}["DEP: ${escapeLabel(dep)}"]`);
    });
    lines.push('    end');
  }

  if (analysis.functionsDefined.length) {
    sections.push('FunctionsDefined');
    lines.push('    subgraph FunctionsDefined["Functions Defined"]');
    analysis.functionsDefined.forEach((fn, idx) => {
      const f = idx + 1;
      lines.push(`        FU${f}["FUNCTION: ${escapeLabel(fn)}"]`);
    });
    lines.push('    end');
  }

  if (analysis.exports.length) {
    sections.push('Exports');
    lines.push('    subgraph Exports["Exports"]');
    analysis.exports.forEach((ex, idx) => {
      const e = idx + 1;
      lines.push(`        E${e}["EXP: ${escapeLabel(ex)}"]`);
    });
    lines.push('    end');
  }

  if (analysis.params.length) {
    sections.push('Parameters');
    lines.push('    subgraph Parameters["Parameters"]');
    analysis.params.forEach((p, idx) => {
      const n = idx + 1;
      lines.push(`        P${n}["PARAM: {${escapeLabel(p.type)}} ${escapeLabel(p.name)} - ${escapeLabel(p.description || '')}"]`);
    });
    lines.push('    end');
  }

  if (analysis.constants.length) {
    sections.push('Constants');
    lines.push('    subgraph Constants["Const Declarations"]');
    analysis.constants.forEach((c, idx) => {
      const n = idx + 1;
      lines.push(`        C${n}["CONST: ${escapeLabel(c.name)}, VALUE: ${escapeLabel(c.value)}"]`);
    });
    lines.push('    end');
  }

  if (analysis.env.length) {
    sections.push('EnvironmentVariables');
    lines.push('    subgraph EnvironmentVariables["Environment Variables"]');
    analysis.env.forEach((v, idx) => {
      const n = idx + 1;
      lines.push(`        ENV${n}["ENV: ${escapeLabel(v)}, USAGE: accessed via process.env"]`);
    });
    lines.push('    end');
  }

  if (analysis.executionFlow.length) {
    sections.push('ExecutionFlow');
    lines.push('    subgraph ExecutionFlow["Execution Flow"]');
    analysis.executionFlow.forEach((step, idx) => {
      const n = idx + 1;
      lines.push(`        FL${n}["${escapeLabel(step)}"]`);
    });
    lines.push('    end');
  }

  // Container subgraph for the file itself
  lines.push(`    subgraph FileName["${escapeLabel(path.basename(fileAbsPath))}"]`);
  sections.forEach(sec => lines.push(`        ${sec}`));
  lines.push('    end');

  // Connect execution flow arrows
  if (analysis.executionFlow.length >= 2) {
    for (let i = 1; i < analysis.executionFlow.length; i++) {
      lines.push(`    FL${i} --> FL${i + 1}`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function escapeLabel(s) {
  // Escape double quotes and backslashes for Mermaid label safety
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function writeFileSafely(filePath, content) {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

// ---------- Master Diagrams ----------
function renderLayerMaster(layerName, filesData) {
  // Aggregate shared sections (simple union across files)
  const sharedImports = new Map(); // key -> count
  const sharedDependencies = new Map();
  const sharedParameters = new Map();
  const sharedConstants = new Map();

  for (const fd of filesData) {
    for (const imp of fd.analysis.imports) {
      const key = `IMPORT: ${imp.spec}, FROM: ${imp.from}`;
      sharedImports.set(key, (sharedImports.get(key) || 0) + 1);
    }
    for (const dep of fd.analysis.dependencies) {
      sharedDependencies.set(dep, (sharedDependencies.get(dep) || 0) + 1);
    }
    for (const p of fd.analysis.params) {
      const key = `PARAM: {${p.type}} ${p.name} - ${p.description || ''}`;
      sharedParameters.set(key, (sharedParameters.get(key) || 0) + 1);
    }
    for (const c of fd.analysis.constants) {
      const key = `CONST: ${c.name}, VALUE: ${c.value}`;
      sharedConstants.set(key, (sharedConstants.get(key) || 0) + 1);
    }
  }

  const lines = [];
  lines.push('```mermaid');
  lines.push('flowchart TB');

  // Shared Infrastructure Sections
  lines.push('    %% SHARED INFRASTRUCTURE SECTIONS');
  lines.push('    subgraph SharedImports["Shared-Infrastructure-Imports"]');
  let i = 1;
  if (sharedImports.size === 0) {
    lines.push('        I0["(none)"]');
  } else {
    for (const key of sharedImports.keys()) {
      lines.push(`        I${i++}["${escapeLabel(key)}"]`);
    }
  }
  lines.push('    end');

  lines.push('    subgraph SharedDependencies["Shared-Infrastructure-Dependencies"]');
  let d = 1;
  if (sharedDependencies.size === 0) {
    lines.push('        D0["(none)"]');
  } else {
    for (const key of sharedDependencies.keys()) {
      lines.push(`        D${d++}["DEP: ${escapeLabel(key)}"]`);
    }
  }
  lines.push('    end');

  lines.push('    subgraph SharedParameters["Shared-Infrastructure-Parameters"]');
  let pIdx = 1;
  if (sharedParameters.size === 0) {
    lines.push('        P0["(none)"]');
  } else {
    for (const key of sharedParameters.keys()) {
      lines.push(`        P${pIdx++}["${escapeLabel(key)}"]`);
    }
  }
  lines.push('    end');

  lines.push('    subgraph SharedConstants["Shared-Infrastructure-Constants"]');
  let cIdx = 1;
  if (sharedConstants.size === 0) {
    lines.push('        C0["(none)"]');
  } else {
    for (const key of sharedConstants.keys()) {
      lines.push(`        C${cIdx++}["${escapeLabel(key)}"]`);
    }
  }
  lines.push('    end');

  // Individual File Sections
  let fileSectionIndex = 1;
  for (const fd of filesData) {
    const label = normalizeToPosix(path.relative(TARGET_DIRECTORY, fd.absPath));
    const idPrefix = `file${fileSectionIndex}`;
    lines.push(`    subgraph ${idPrefix}["${escapeLabel(label)}"]`);

    // File imports
    lines.push(`        subgraph ${idPrefix}Imports["${escapeLabel(path.basename(label))}-Imports"]`);
    if (fd.analysis.imports.length === 0) {
      lines.push('            I0["(none)"]');
    } else {
      let fi = 1;
      for (const imp of fd.analysis.imports) {
        const from = imp.from.startsWith('/') ? imp.from : imp.from;
        lines.push(`            I${fi++}["IMPORT: ${escapeLabel(imp.spec)}, FROM: ${escapeLabel(from)}"]`);
      }
    }
    lines.push('        end');

    // File functions
    lines.push(`        subgraph ${idPrefix}Functions["${escapeLabel(path.basename(label))}-Functions Defined"]`);
    if (fd.analysis.functionsDefined.length === 0) {
      lines.push('            FU0["(none)"]');
    } else {
      let f = 1;
      for (const fn of fd.analysis.functionsDefined) {
        lines.push(`            FU${f++}["FUNCTION: ${escapeLabel(fn)}"]`);
      }
    }
    lines.push('        end');

    // File exports
    lines.push(`        subgraph ${idPrefix}Exports["${escapeLabel(path.basename(label))}-Exports"]`);
    if (fd.analysis.exports.length === 0) {
      lines.push('            E0["(none)"]');
    } else {
      let e = 1;
      for (const ex of fd.analysis.exports) {
        lines.push(`            E${e++}["EXP: ${escapeLabel(ex)}"]`);
      }
    }
    lines.push('        end');

    // File constants
    lines.push(`        subgraph ${idPrefix}Constants["${escapeLabel(path.basename(label))}-Const Declarations"]`);
    if (fd.analysis.constants.length === 0) {
      lines.push('            C0["(none)"]');
    } else {
      let c = 1;
      for (const con of fd.analysis.constants) {
        lines.push(`            C${c++}["CONST: ${escapeLabel(con.name)}, VALUE: ${escapeLabel(con.value)}"]`);
      }
    }
    lines.push('        end');

    // File execution flow
    lines.push(`        subgraph ${idPrefix}Flow["${escapeLabel(path.basename(label))}-Execution Flow"]`);
    if (fd.analysis.executionFlow.length === 0) {
      lines.push('            FL0["(none)"]');
    } else {
      for (let idx = 0; idx < fd.analysis.executionFlow.length; idx++) {
        const step = fd.analysis.executionFlow[idx];
        lines.push(`            FL${idx + 1}["${escapeLabel(step)}"]`);
      }
    }
    lines.push('        end');

    lines.push('    end');
    fileSectionIndex++;
  }

  // Relationship connections (coarse)
  if (filesData.length > 0) {
    lines.push('    SharedImports --> file1Imports');
    lines.push('    SharedDependencies --> file1');
    lines.push('    SharedParameters --> file1');
    lines.push('    SharedConstants --> file1Constants');
  }

  // Execution flow connections are per-file; omitted in master
  lines.push('```');
  return lines.join('\n');
}

function renderSystemOverview(layerCounts) {
  const lines = [];
  lines.push('```mermaid');
  lines.push('flowchart TB');
  lines.push('    subgraph InterfaceLayer["Interface Layer"]');
  lines.push(`        IL1["MCP Tools (${layerCounts.interface} files)"]`);
  lines.push('    end');
  lines.push('    subgraph CoreLayer["Core Implementation Layer"]');
  lines.push(`        CL1["Direct Functions & Core Logic (${layerCounts.core} files)"]`);
  lines.push('    end');
  lines.push('    subgraph SharedLayer["Shared Infrastructure Layer"]');
  lines.push(`        SL1["Utilities, Providers, Constants (${layerCounts.shared} files)"]`);
  lines.push('    end');
  lines.push('    IL1 --> CL1');
  lines.push('    CL1 --> SL1');
  lines.push('```');
  return lines.join('\n');
}

// ---------- Scanner ----------
function scanDirectory(dirAbsPath, out) {
  const entries = fs.readdirSync(dirAbsPath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirAbsPath, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDir(abs)) continue;
      scanDirectory(abs, out);
    } else if (entry.isFile()) {
      if (shouldSkipFile(abs)) {
        out.skipped.push({ absPath: abs, reason: 'Excluded by type/name' });
        continue;
      }
      out.files.push(abs);
    }
  }
}

// ---------- Main ----------
(function main() {
  console.log('[diagram-gen] Starting scan...');
  ensureDirSync(OUTPUT_DIR_SHARED);
  ensureDirSync(OUTPUT_DIR_CORE);
  ensureDirSync(OUTPUT_DIR_INTERFACE);
  ensureDirSync(OUTPUT_DIR_MASTER);

  const collected = { files: [], skipped: [] };
  scanDirectory(TARGET_DIRECTORY, collected);

  const perLayer = { interface: [], core: [], shared: [] };
  const analysisSummary = [];

  for (const fileAbs of collected.files) {
    let content = '';
    try {
      content = fs.readFileSync(fileAbs, 'utf8');
    } catch (e) {
      collected.skipped.push({ absPath: fileAbs, reason: `Read error: ${e.message}` });
      continue;
    }

    const imports = extractImports(content, fileAbs);
    const functionsDefined = extractFunctionsDefined(content);
    const exportsArr = extractExports(content);
    const params = extractJsDocParams(content);
    const constants = extractConstants(content);
    const env = extractEnvVars(content);
    const executionFlow = buildExecutionFlow(imports, functionsDefined, exportsArr);

    // Heuristic dependencies: if using FastMCP or file system or path, reflect them
    const dependencies = [];
    if (/fastmcp|mcp-server|server\.js/.test(content)) dependencies.push('FastMCP');
    if (/fs\b/.test(content)) dependencies.push('File system');
    if (/path\b/.test(content)) dependencies.push('Path resolution');

    const analysis = { imports, dependencies, functionsDefined, exports: exportsArr, params, constants, env, executionFlow };

    const layer = determineLayer(fileAbs);
    const outRoot = layer === 'interface' ? OUTPUT_DIR_INTERFACE : layer === 'core' ? OUTPUT_DIR_CORE : OUTPUT_DIR_SHARED;
    const relFromTarget = path.relative(TARGET_DIRECTORY, fileAbs);
    const outFile = path.join(outRoot, relFromTarget + '_diagram.mmd');

    const diagram = renderFileDiagram(fileAbs, analysis);
    writeFileSafely(outFile, diagram);

    const record = { absPath: fileAbs, relFromTarget, layer, analysis, outFile };
    perLayer[layer].push(record);
    analysisSummary.push({ file: toProjectDisplayPath(fileAbs), layer, out: toProjectDisplayPath(outFile) });
  }

  // Write layer master diagrams
  const masterInterface = renderLayerMaster('Interface', perLayer.interface);
  const masterCore = renderLayerMaster('Core', perLayer.core);
  const masterShared = renderLayerMaster('Shared', perLayer.shared);

  writeFileSafely(path.join(OUTPUT_DIR_MASTER, 'interface-layer-master.mmd'), masterInterface);
  writeFileSafely(path.join(OUTPUT_DIR_MASTER, 'core-implementation-layer-master.mmd'), masterCore);
  writeFileSafely(path.join(OUTPUT_DIR_MASTER, 'shared-infrastructure-layer-master.mmd'), masterShared);

  // System overview
  const overview = renderSystemOverview({ interface: perLayer.interface.length, core: perLayer.core.length, shared: perLayer.shared.length });
  writeFileSafely(path.join(OUTPUT_DIR_MASTER, 'system-architecture-master.mmd'), overview);

  // Analysis summary
  const summaryLines = [];
  summaryLines.push('# Analysis Summary');
  summaryLines.push('');
  summaryLines.push(`- Target directory: \`${normalizeToPosix(TARGET_DIRECTORY)}\``);
  summaryLines.push(`- Files processed: ${analysisSummary.length}`);
  summaryLines.push(`  - Interface layer: ${perLayer.interface.length}`);
  summaryLines.push(`  - Core layer: ${perLayer.core.length}`);
  summaryLines.push(`  - Shared layer: ${perLayer.shared.length}`);
  summaryLines.push(`- Files skipped: ${collected.skipped.length}`);
  summaryLines.push('');
  summaryLines.push('## Processed Files');
  summaryLines.push('');
  for (const rec of analysisSummary) {
    summaryLines.push(`- ${rec.file} → [diagram](${rec.out}) (${rec.layer})`);
  }
  if (collected.skipped.length) {
    summaryLines.push('');
    summaryLines.push('## Skipped Files');
    summaryLines.push('');
    for (const s of collected.skipped) {
      summaryLines.push(`- ${toProjectDisplayPath(s.absPath)} — ${s.reason}`);
    }
  }

  writeFileSafely(path.join(OUTPUT_DIR_MASTER, 'analysis_summary.md'), summaryLines.join('\n'));
  console.log('[diagram-gen] Completed.');
})();


