#!/usr/bin/env node

/**
 * Test script for TOT MCP server with PNG/SVG export
 * This script creates a test tree and exports it in different formats
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

async function testTOTExport() {
  console.log('Starting TOT MCP server...');
  
  // Start the TOT MCP server
  const serverProcess = spawn('node', ['dist/index.js'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit']
  });

  // Create MCP client
  const transport = new StdioClientTransport({
    stderr: process.stderr,
    stdout: serverProcess.stdout,
    stdin: serverProcess.stdin
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  try {
    await client.connect(transport);
    console.log('Connected to TOT MCP server');

    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:', tools.tools.map(t => t.name));

    // Create a test tree
    console.log('\n1. Creating test tree...');
    const createTreeResult = await client.callTool({
      name: 'create_tree',
      arguments: {
        goal: 'Test tree for PNG/SVG export',
        rootContent: 'Root thought for testing',
        maxDepth: 3
      }
    });
    console.log('Tree created:', createTreeResult.content[0].text);

    // Parse tree ID from response
    const treeIdMatch = createTreeResult.content[0].text.match(/ID: ([a-f0-9-]+)/);
    if (!treeIdMatch) {
      throw new Error('Could not extract tree ID from response');
    }
    const treeId = treeIdMatch[1];
    console.log('Tree ID:', treeId);

    // Add child thoughts
    console.log('\n2. Adding child thoughts...');
    const addChild1 = await client.callTool({
      name: 'add_child',
      arguments: {
        treeId: treeId,
        parentId: treeId,
        content: 'First child thought - pending'
      }
    });
    console.log('Child 1 added:', addChild1.content[0].text);

    const addChild2 = await client.callTool({
      name: 'add_child',
      arguments: {
        treeId: treeId,
        parentId: treeId,
        content: 'Second child thought - pending'
      }
    });
    console.log('Child 2 added:', addChild2.content[0].text);

    // Parse child IDs
    const child1Match = addChild1.content[0].text.match(/ID: ([a-f0-9-]+)/);
    const child2Match = addChild2.content[0].text.match(/ID: ([a-f0-9-]+)/);
    const child1Id = child1Match ? child1Match[1] : '';
    const child2Id = child2Match ? child2Match[1] : '';

    // Evaluate some thoughts
    console.log('\n3. Evaluating thoughts...');
    if (child1Id) {
      const eval1 = await client.callTool({
        name: 'evaluate_thought',
        arguments: {
          treeId: treeId,
          thoughtId: child1Id,
          score: 85,
          creativity: 75,
          risk: 30
        }
      });
      console.log('Child 1 evaluated:', eval1.content[0].text);
    }

    if (child2Id) {
      const eval2 = await client.callTool({
        name: 'evaluate_thought',
        arguments: {
          treeId: treeId,
          thoughtId: child2Id,
          score: 60,
          creativity: 40,
          risk: 70
        }
      });
      console.log('Child 2 evaluated:', eval2.content[0].text);
    }

    // Export as ASCII (baseline)
    console.log('\n4. Exporting as ASCII...');
    const asciiResult = await client.callTool({
      name: 'visualize_tree',
      arguments: {
        treeId: treeId,
        format: 'ascii'
      }
    });
    console.log('ASCII export:');
    console.log(asciiResult.content[0].text);

    // Export as Mermaid (baseline)
    console.log('\n5. Exporting as Mermaid...');
    const mermaidResult = await client.callTool({
      name: 'visualize_tree',
      arguments: {
        treeId: treeId,
        format: 'mermaid'
      }
    });
    console.log('Mermaid export (first 500 chars):');
    console.log(mermaidResult.content[0].text.substring(0, 500) + '...');

    // Export as PNG (NEW FEATURE)
    console.log('\n6. Exporting as PNG (NEW FEATURE)...');
    const pngResult = await client.callTool({
      name: 'visualize_tree',
      arguments: {
        treeId: treeId,
        format: 'png'
      }
    });
    console.log('PNG export result type:', pngResult.content[0].type);
    if (pngResult.content[0].type === 'image') {
      console.log('PNG data length:', pngResult.content[0].data.length);
      console.log('PNG MIME type:', pngResult.content[0].mimeType);
      
      // Save PNG to file
      const fs = await import('fs');
      const buffer = Buffer.from(pngResult.content[0].data, 'base64');
      fs.writeFileSync('test-tree.png', buffer);
      console.log('PNG saved to test-tree.png');
    }

    // Export as SVG (NEW FEATURE)
    console.log('\n7. Exporting as SVG (NEW FEATURE)...');
    const svgResult = await client.callTool({
      name: 'visualize_tree',
      arguments: {
        treeId: treeId,
        format: 'svg'
      }
    });
    console.log('SVG export result type:', svgResult.content[0].type);
    if (svgResult.content[0].type === 'image') {
      console.log('SVG data length:', svgResult.content[0].data.length);
      console.log('SVG MIME type:', svgResult.content[0].mimeType);
      
      // Save SVG to file
      const fs = await import('fs');
      const buffer = Buffer.from(svgResult.content[0].data, 'base64');
      fs.writeFileSync('test-tree.svg', buffer);
      console.log('SVG saved to test-tree.svg');
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('Generated files: test-tree.png, test-tree.svg');

  } catch (error) {
    console.error('Error during testing:', error);
  } finally {
    await client.close();
    serverProcess.kill();
  }
}

testTOTExport().catch(console.error);
