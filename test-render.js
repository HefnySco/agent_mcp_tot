#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderMermaid } from './dist/utils/mermaidRenderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_PATH = path.join(__dirname, 'tot-storage.json');
const OUTPUT_DIR = path.join(__dirname, 'output');

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

// Generate Mermaid flowchart for a single tree (matching TOT service format)
function generateTreeMermaid(tree) {
  let mermaid = `flowchart TD\n`;
  mermaid += `    Root["${tree.goal}"]\n`;
  mermaid += '\n';
  mermaid += '    classDef pending fill:#f0f0f0,stroke:#999,stroke-width:1px\n';
  mermaid += '    classDef evaluated fill:#90EE90,stroke:#228B22,stroke-width:2px\n';
  mermaid += '    classDef selected fill:#FFD700,stroke:#DAA520,stroke-width:2px\n';
  mermaid += '    classDef pruned fill:#FFB6C1,stroke:#DC143C,stroke-width:2px\n';
  mermaid += '\n';

  const thoughts = Object.entries(tree.thoughts);
  const thoughtMap = new Map(thoughts);

  const renderNode = (thoughtId, parentId) => {
    const thought = thoughtMap.get(thoughtId);
    if (!thought) return;

    const nodeId = `N${thoughtId.substring(0, 8)}`;
    const stateStyle = getStateStyle(thought.state);
    const label = thought.content.substring(0, 50).replace(/"/g, '\\"');
    const evalScore = thought.evaluation !== null ? ` [${thought.evaluation}]` : '';
    
    mermaid += `    ${nodeId}["${label}${evalScore}"]${stateStyle}\n`;

    if (parentId) {
      const parentNodeId = `N${parentId.substring(0, 8)}`;
      mermaid += `    ${parentNodeId} --> ${nodeId}\n`;
    }

    for (const childId of thought.children) {
      renderNode(childId, thoughtId);
    }
  };

  const rootThought = thoughtMap.get(tree.rootId);
  if (rootThought) {
    const rootNodeId = `N${rootThought.id.substring(0, 8)}`;
    const rootLabel = rootThought.content.substring(0, 50).replace(/"/g, '\\"');
    const rootEval = rootThought.evaluation !== null ? ` [${rootThought.evaluation}]` : '';
    const rootStyle = getStateStyle(rootThought.state);
    
    mermaid += `    ${rootNodeId}["${rootLabel}${rootEval}"]${rootStyle}\n`;
    mermaid += `    Root --> ${rootNodeId}\n`;
    
    for (const childId of rootThought.children) {
      renderNode(childId, rootThought.id);
    }
  }

  return mermaid;
}

function getStateStyle(state) {
  switch (state) {
    case 'pending': return ':::pending';
    case 'evaluated': return ':::evaluated';
    case 'selected': return ':::selected';
    case 'pruned': return ':::pruned';
    default: return '';
  }
}

// Main execution
async function main() {
  console.log('Reading TOT storage...');
  const storage = readStorage();
  const trees = Object.values(storage.trees || {});

  if (trees.length === 0) {
    console.log('No trees found in storage. Creating a test tree...');
    return;
  }

  console.log(`Found ${trees.length} trees in storage`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Test with the first tree
  const tree = trees[0];
  console.log(`\nTesting with tree: ${tree.id}`);
  console.log(`Goal: ${tree.goal}`);
  console.log(`Thoughts: ${Object.keys(tree.thoughts).length}`);

  // Generate mermaid code
  console.log('\nGenerating Mermaid code...');
  const mermaidCode = generateTreeMermaid(tree);
  
  // Save mermaid code for reference
  const mermaidPath = path.join(OUTPUT_DIR, `test-tree-${tree.id.substring(0, 8)}.mmd`);
  fs.writeFileSync(mermaidPath, mermaidCode);
  console.log(`Mermaid code saved to: ${mermaidPath}`);

  // Test PNG export
  console.log('\nRendering PNG...');
  try {
    const pngResult = await renderMermaid(mermaidCode, 'png');
    const pngBuffer = Buffer.from(pngResult.data, 'base64');
    const pngPath = path.join(OUTPUT_DIR, `test-tree-${tree.id.substring(0, 8)}.png`);
    fs.writeFileSync(pngPath, pngBuffer);
    console.log(`✅ PNG saved to: ${pngPath}`);
    console.log(`   Size: ${pngBuffer.length} bytes`);
  } catch (error) {
    console.error(`❌ PNG rendering failed: ${error.message}`);
  }

  // Test SVG export
  console.log('\nRendering SVG...');
  try {
    const svgResult = await renderMermaid(mermaidCode, 'svg');
    const svgBuffer = Buffer.from(svgResult.data, 'base64');
    const svgPath = path.join(OUTPUT_DIR, `test-tree-${tree.id.substring(0, 8)}.svg`);
    fs.writeFileSync(svgPath, svgBuffer);
    console.log(`✅ SVG saved to: ${svgPath}`);
    console.log(`   Size: ${svgBuffer.length} bytes`);
  } catch (error) {
    console.error(`❌ SVG rendering failed: ${error.message}`);
  }

  console.log('\n✅ Testing complete!');
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main().catch(console.error);
