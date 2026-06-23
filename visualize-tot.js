#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_PATH = process.env.TOT_STORAGE_PATH || path.join(__dirname, 'tot-storage.json');
const OUTPUT_DIR = process.env.TOT_OUTPUT_DIR || path.join(__dirname, 'output');

// Read storage file
function readStorage() {
  try {
    const data = fs.readFileSync(STORAGE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading storage file: ${err.message}`);
    process.exit(1);
  }
}

// Generate Mermaid flowchart for a single tree
function generateTreeMermaid(tree) {
  let mermaid = `graph TD\n`;
  mermaid += `    %% Tree: ${tree.id}\n`;
  mermaid += `    %% Goal: ${tree.goal}\n`;
  mermaid += `    %% Created: ${tree.createdAt}\n\n`;

  const thoughts = Object.entries(tree.thoughts);
  const thoughtMap = new Map(thoughts);

  // Define style classes first
  mermaid += '    classDef evaluated fill:#b5e7a0,stroke:#2f855a\n';
  mermaid += '    classDef selected fill:#90cdf4,stroke:#2b6cb0,stroke-width:3px\n';
  mermaid += '    classDef pruned fill:#fed7d7,stroke:#c53030,stroke-dasharray: 5 5\n';
  mermaid += '    classDef pending fill:#feebc8,stroke:#dd6b20\n\n';

  // Generate nodes with class assignment based on state
  for (const [id, thought] of thoughts) {
    const label = thought.content.substring(0, 30).replace(/"/g, '\\"');
    const evalScore = thought.evaluation !== null ? ` (${thought.evaluation})` : '';
    const nodeId = `T${id.substring(0, 8)}`;
    
    mermaid += `    ${nodeId}["${label}${evalScore}"]\n`;
  }

  mermaid += '\n';

  // Generate edges
  for (const [id, thought] of thoughts) {
    const nodeId = `T${id.substring(0, 8)}`;
    for (const childId of thought.children) {
      const childNodeId = `T${childId.substring(0, 8)}`;
      mermaid += `    ${nodeId} --> ${childNodeId}\n`;
    }
  }

  mermaid += '\n';

  // Apply classes to nodes
  const evaluatedNodes = [];
  const selectedNodes = [];
  const prunedNodes = [];
  const pendingNodes = [];

  for (const [id, thought] of thoughts) {
    const nodeId = `T${id.substring(0, 8)}`;
    switch (thought.state) {
      case 'evaluated':
        evaluatedNodes.push(nodeId);
        break;
      case 'selected':
        selectedNodes.push(nodeId);
        break;
      case 'pruned':
        prunedNodes.push(nodeId);
        break;
      case 'pending':
        pendingNodes.push(nodeId);
        break;
    }
  }

  if (evaluatedNodes.length > 0) {
    mermaid += `    class ${evaluatedNodes.join(',')} evaluated\n`;
  }
  if (selectedNodes.length > 0) {
    mermaid += `    class ${selectedNodes.join(',')} selected\n`;
  }
  if (prunedNodes.length > 0) {
    mermaid += `    class ${prunedNodes.join(',')} pruned\n`;
  }
  if (pendingNodes.length > 0) {
    mermaid += `    class ${pendingNodes.join(',')} pending\n`;
  }

  return mermaid;
}

// Generate Mermaid mindmap for a single tree
function generateTreeMindmap(tree) {
  let mermaid = `mindmap\n`;
  mermaid += `  root((${tree.goal.substring(0, 20)}))\n`;

  const thoughts = Object.entries(tree.thoughts);
  const thoughtMap = new Map(thoughts);

  // Build hierarchy recursively
  function buildMindmap(thoughtId, depth) {
    const thought = thoughtMap.get(thoughtId);
    if (!thought) return '';

    const indent = '  '.repeat(depth + 1);
    const label = thought.content.substring(0, 25).replace(/"/g, '\\"');
    const stateIcon = {
      'evaluated': '✓',
      'selected': '★',
      'pruned': '✗',
      'pending': '○'
    }[thought.state] || '';

    let result = `${indent}${stateIcon} ${label}\n`;

    for (const childId of thought.children) {
      result += buildMindmap(childId, depth + 1);
    }

    return result;
  }

  mermaid += buildMindmap(tree.rootId, 0);
  return mermaid;
}

// Generate summary statistics
function generateSummary(storage) {
  const trees = Object.values(storage.trees || {});
  let summary = '# ToT Storage Summary\n\n';
  summary += `Total Trees: ${trees.length}\n\n`;

  for (const tree of trees) {
    const thoughts = Object.values(tree.thoughts);
    const evaluated = thoughts.filter(t => t.state === 'evaluated').length;
    const selected = thoughts.filter(t => t.state === 'selected').length;
    const pruned = thoughts.filter(t => t.state === 'pruned').length;
    const pending = thoughts.filter(t => t.state === 'pending').length;
    const maxDepth = Math.max(...thoughts.map(t => t.depth));

    summary += `## Tree: ${tree.id}\n`;
    summary += `- Goal: ${tree.goal}\n`;
    summary += `- Total Thoughts: ${thoughts.length}\n`;
    summary += `- Evaluated: ${evaluated}\n`;
    summary += `- Selected: ${selected}\n`;
    summary += `- Pruned: ${pruned}\n`;
    summary += `- Pending: ${pending}\n`;
    summary += `- Max Depth: ${maxDepth}\n`;
    summary += `- Created: ${tree.createdAt}\n`;
    summary += `- Updated: ${tree.updatedAt}\n\n`;
  }

  return summary;
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  const format = args[0] || 'flowchart'; // 'flowchart' or 'mindmap'
  const treeId = args[1]; // optional specific tree ID

  const storage = readStorage();
  const trees = Object.values(storage.trees || {});

  if (trees.length === 0) {
    console.log('No trees found in storage.');
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate summary
  const summaryPath = path.join(OUTPUT_DIR, 'tot-summary.md');
  fs.writeFileSync(summaryPath, generateSummary(storage));
  console.log(`Summary written to: ${summaryPath}`);

  // Generate visualizations
  if (treeId) {
    // Single tree
    const tree = trees.find(t => t.id === treeId);
    if (!tree) {
      console.error(`Tree ${treeId} not found`);
      process.exit(1);
    }
    generateVisualization(tree, format);
  } else {
    // All trees
    for (const tree of trees) {
      generateVisualization(tree, format);
    }
  }
}

function generateVisualization(tree, format) {
  const filename = `tot-${tree.id.substring(0, 8)}-${format}.mmd`;
  const filepath = path.join(OUTPUT_DIR, filename);

  let mermaid;
  if (format === 'mindmap') {
    mermaid = generateTreeMindmap(tree);
  } else {
    mermaid = generateTreeMermaid(tree);
  }

  fs.writeFileSync(filepath, mermaid);
  console.log(`Generated ${format} for tree ${tree.id}: ${filepath}`);
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateTreeMermaid, generateTreeMindmap, generateSummary };
