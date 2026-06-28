/**
 * Tree-related tool handlers for ToT MCP Server
 * Handles create_tree, get_tree, list_trees, delete_tree operations
 */

import { ToTService } from '../totService.js';
import { validateRequiredString, validateMinNumber, validateSessionId } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

export async function handleCreateTree(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const goal = args?.goal as string;
  const rootContent = args?.rootContent as string;
  const maxDepth = args?.maxDepth as number | undefined;
  const sessionId = args?.sessionId as string | undefined;
  const metadata = args?.metadata as Record<string, any> | undefined;

  validateRequiredString(goal, 'goal');
  validateRequiredString(rootContent, 'rootContent');
  validateSessionId(sessionId);

  if (maxDepth !== undefined) {
    validateMinNumber(maxDepth, 'maxDepth', 1);
  }

  const tree = totService.createTree({
    goal,
    rootContent,
    maxDepth,
    sessionId,
    metadata
  });

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Tree created successfully',
          tree: {
            id: tree.id,
            goal: tree.goal,
            rootId: tree.rootId,
            maxDepth: tree.maxDepth,
            sessionId: tree.metadata?.sessionId
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('create_tree', args, result);
  return result;
}

export async function handleGetTree(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  validateRequiredString(treeId, 'treeId');

  const tree = totService.getTree(treeId);
  
  if (!tree) {
    throw new Error('Tree not found');
  }

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tree: {
            id: tree.id,
            goal: tree.goal,
            rootId: tree.rootId,
            maxDepth: tree.maxDepth,
            createdAt: tree.createdAt,
            updatedAt: tree.updatedAt,
            thoughtCount: tree.thoughts.size
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('get_tree', args, result);
  return result;
}

export async function handleListTrees(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const trees = totService.getAllTrees();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          trees: trees.map(t => ({
            id: t.id,
            goal: t.goal,
            rootId: t.rootId,
            maxDepth: t.maxDepth,
            thoughtCount: t.thoughts.size,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt
          })),
          count: trees.length
        }, null, 2)
      }
    ]
  };
  await logRequest('list_trees', args, result);
  return result;
}

export async function handleDeleteTree(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  validateRequiredString(treeId, 'treeId');

  const deleted = totService.deleteTree(treeId);
  
  if (!deleted) {
    throw new Error('Tree not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Tree deleted successfully',
          treeId
        }, null, 2)
      }
    ]
  };
  await logRequest('delete_tree', args, result);
  return result;
}

export async function handleClearTree(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  validateRequiredString(treeId, 'treeId');

  const cleared = totService.clearTree(treeId);
  
  if (!cleared) {
    throw new Error('Tree not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Tree cleared successfully',
          treeId
        }, null, 2)
      }
    ]
  };
  await logRequest('clear_tree', args, result);
  return result;
}
