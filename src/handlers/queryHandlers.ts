/**
 * Query-related tool handlers for ToT MCP Server
 * Handles get_thought, get_tree_structure, get_best_thoughts, get_tree_stats operations
 */

import { ToTService } from '../totService.js';
import { validateRequiredString, validateMinNumber, validateEnum } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

export async function handleGetThought(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const thoughtId = args?.thoughtId as string;

  validateRequiredString(treeId, 'treeId');
  validateRequiredString(thoughtId, 'thoughtId');

  const thought = totService.getThought(treeId, thoughtId);
  
  if (!thought) {
    throw new Error('Tree or thought not found');
  }

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          thought
        }, null, 2)
      }
    ]
  };
  await logRequest('get_thought', args, result);
  return result;
}

export async function handleGetTreeStructure(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  validateRequiredString(treeId, 'treeId');

  const structure = totService.getTreeStructure(treeId);
  
  if (!structure) {
    throw new Error('Tree not found');
  }

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          structure
        }, null, 2)
      }
    ]
  };
  await logRequest('get_tree_structure', args, result);
  return result;
}

export async function handleGetBestThoughts(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const limit = args?.limit as number | undefined;
  const sortBy = args?.sortBy as 'evaluation' | 'creativity' | 'risk' | 'combined' | undefined;

  validateRequiredString(treeId, 'treeId');

  if (limit !== undefined) {
    validateMinNumber(limit, 'limit', 1);
  }

  if (sortBy !== undefined) {
    validateEnum(sortBy, 'sortBy', ['evaluation', 'creativity', 'risk', 'combined']);
  }

  const thoughts = totService.getBestThoughts(treeId, limit, sortBy);

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          thoughts,
          count: thoughts.length
        }, null, 2)
      }
    ]
  };
  await logRequest('get_best_thoughts', args, result);
  return result;
}

export async function handleGetTreeStats(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  validateRequiredString(treeId, 'treeId');

  const stats = totService.getTreeStats(treeId);
  
  if (!stats) {
    throw new Error('Tree not found');
  }

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          treeId,
          stats
        }, null, 2)
      }
    ]
  };
  await logRequest('get_tree_stats', args, result);
  return result;
}
