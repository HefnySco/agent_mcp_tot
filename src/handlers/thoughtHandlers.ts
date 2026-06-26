/**
 * Thought-related tool handlers for ToT MCP Server
 * Handles add_child, evaluate_thought, verify_thought, select_thought, backtrack, prune_tree operations
 */

import { ToTService } from '../totService.js';
import { validateRequiredString, validateSessionId, validateEvaluationScore, validateNumberRange } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

export async function handleAddChild(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const parentId = args?.parentId as string;
  const content = args?.content as string;
  const sessionId = args?.sessionId as string | undefined;
  const metadata = args?.metadata as Record<string, any> | undefined;

  validateRequiredString(treeId, 'treeId');
  validateRequiredString(parentId, 'parentId');
  validateRequiredString(content, 'content');
  validateSessionId(sessionId);

  const thought = totService.addChildThought({
    treeId,
    parentId,
    content,
    sessionId,
    metadata
  });
  
  if (!thought) {
    throw new Error('Tree or parent thought not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Child thought added successfully',
          thought: {
            id: thought.id,
            content: thought.content,
            parentId: thought.parentId,
            depth: thought.depth,
            sessionId: thought.metadata?.sessionId
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('add_child', args, result);
  return result;
}

export async function handleEvaluateThought(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const thoughtId = args?.thoughtId as string;
  const score = args?.score as number;
  const creativity = args?.creativity as number | undefined;
  const risk = args?.risk as number | undefined;
  const criteriaScores = args?.criteriaScores as Record<string, number> | undefined;
  const reasoning = args?.reasoning as string | undefined;

  validateRequiredString(treeId, 'treeId');
  validateRequiredString(thoughtId, 'thoughtId');
  validateEvaluationScore(score);

  if (creativity !== undefined) {
    validateNumberRange(creativity, 'creativity', 0, 100);
  }
  if (risk !== undefined) {
    validateNumberRange(risk, 'risk', 0, 100);
  }

  const thought = totService.evaluateThought({
    treeId,
    thoughtId,
    score,
    creativity,
    risk,
    criteriaScores,
    reasoning
  });
  
  if (!thought) {
    throw new Error('Tree or thought not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Thought evaluated successfully',
          thought: {
            id: thought.id,
            content: thought.content,
            evaluation: thought.evaluation,
            state: thought.state
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('evaluate_thought', args, result);
  return result;
}

export async function handleVerifyThought(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const thoughtId = args?.thoughtId as string;
  const verificationNotes = args?.verificationNotes as string | undefined;

  validateRequiredString(treeId, 'treeId');
  validateRequiredString(thoughtId, 'thoughtId');

  const thought = totService.verifyThought({
    treeId,
    thoughtId,
    verificationNotes
  });

  if (!thought) {
    throw new Error('Tree or thought not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Thought verified successfully',
          thought: {
            id: thought.id,
            content: thought.content,
            verified: thought.verified,
            verificationNotes: thought.verificationNotes,
            state: thought.state
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('verify_thought', args, result);
  return result;
}

export async function handleSelectThought(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const thoughtId = args?.thoughtId as string;

  validateRequiredString(treeId, 'treeId');
  validateRequiredString(thoughtId, 'thoughtId');

  const thought = totService.selectThought({
    treeId,
    thoughtId
  });
  
  if (!thought) {
    throw new Error('Tree or thought not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Thought selected successfully',
          thought: {
            id: thought.id,
            content: thought.content,
            state: thought.state
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('select_thought', args, result);
  return result;
}

export async function handleBacktrack(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const thoughtId = args?.thoughtId as string;

  validateRequiredString(treeId, 'treeId');
  validateRequiredString(thoughtId, 'thoughtId');

  const thought = totService.backtrack({
    treeId,
    thoughtId
  });
  
  if (!thought) {
    throw new Error('Tree or thought not found');
  }

  await totService.save();

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Backtrack successful',
          thought: {
            id: thought.id,
            content: thought.content,
            state: thought.state
          }
        }, null, 2)
      }
    ]
  };
  await logRequest('backtrack', args, result);
  return result;
}

export async function handlePruneTree(
  totService: ToTService,
  args: any,
  logRequest: (name: string, args: any, result: any) => Promise<void>
) {
  const treeId = args?.treeId as string;
  const threshold = args?.threshold as number;
  const riskThreshold = args?.riskThreshold as number | undefined;

  validateRequiredString(treeId, 'treeId');
  validateNumberRange(threshold, 'threshold', 0, 100);

  if (riskThreshold !== undefined) {
    validateNumberRange(riskThreshold, 'riskThreshold', 0, 100);
  }

  const result = totService.pruneTree({
    treeId,
    threshold,
    riskThreshold
  });

  await totService.save();

  const output = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          message: 'Tree pruned successfully',
          ...result
        }, null, 2)
      }
    ]
  };
  await logRequest('prune_tree', args, output);
  return output;
}
