#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToTService, ToTServiceConfig } from './totService.js';
import { MockLLMProvider } from './llm-providers/mock-llm-provider.js';
import { GrokLLMProvider } from './llm-providers/grok-llm-provider.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const logger = {
  info: (message: string) => console.log(`[ToTServer] ${message}`),
  error: (message: string) => console.error(`[ToTServer] ${message}`),
  warn: (message: string) => console.warn(`[ToTServer] ${message}`)
};

function createLLMProvider(): ToTServiceConfig {
  const providerType = process.env.LLM_PROVIDER_TYPE || 'mock';
  const grokApiKey = process.env.GROK_API_KEY;

  if (providerType === 'null' || providerType === 'none') {
    logger.info('Using no LLM provider (null)');
    return { llmProvider: null };
  }

  if (providerType === 'grok') {
    if (!grokApiKey) {
      logger.warn('GROK_API_KEY not set, falling back to MockLLMProvider');
      return { llmProvider: new MockLLMProvider() };
    }
    logger.info('Using GrokLLMProvider');
    return { llmProvider: new GrokLLMProvider(grokApiKey) };
  }

  logger.info('Using MockLLMProvider');
  return { llmProvider: new MockLLMProvider() };
}

class ToTMCPServer {
  private server: Server;
  private totService: ToTService;
  private outputDir: string;

  constructor(config?: ToTServiceConfig) {
    this.outputDir = process.env.TOT_OUTPUT_DIR || path.join(PROJECT_ROOT, 'output');
    const storagePath = process.env.TOT_STORAGE_PATH || path.join(PROJECT_ROOT, 'tot-storage.json');
    this.ensureOutputDir();

    this.server = new Server(
      {
        name: 'tot',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    const llmConfig = config || createLLMProvider();
    this.totService = new ToTService(storagePath, llmConfig);
    this.totService.load().catch(err => {
      logger.error(`Failed to load ToT service state: ${err instanceof Error ? err.message : String(err)}`);
    });

    this.setupHandlers();
  }

  private async ensureOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (err) {
      logger.error(`Failed to create output directory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async logRequest(toolName: string, args: any, result: any) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        tool: toolName,
        arguments: args,
        result: result
      };

      const dateStr = timestamp.split('T')[0];
      const logFile = path.join(this.outputDir, `tot-log-${dateStr}.json`);

      await fs.mkdir(this.outputDir, { recursive: true });

      let logs: any[] = [];
      try {
        const existing = await fs.readFile(logFile, 'utf-8');
        logs = JSON.parse(existing);
      } catch (err) {
        // File doesn't exist or is empty, start fresh
      }

      logs.push(logEntry);
      await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
    } catch (err) {
      logger.error(`Failed to log request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_tree',
            description: 'Create a new Tree of Thoughts with a root thought and goal',
            inputSchema: {
              type: 'object',
              properties: {
                goal: {
                  type: 'string',
                  description: 'The goal or problem this tree is solving'
                },
                rootContent: {
                  type: 'string',
                  description: 'The content of the root thought'
                },
                maxDepth: {
                  type: 'number',
                  description: 'Maximum depth of the tree (default: 10)',
                  minimum: 1
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata for the tree'
                }
              },
              required: ['goal', 'rootContent']
            }
          },
          {
            name: 'get_tree',
            description: 'Get a tree by ID',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to retrieve'
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'list_trees',
            description: 'List all trees',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'delete_tree',
            description: 'Delete a tree by ID',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to delete'
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'add_child',
            description: 'Add a child thought to an existing thought',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                parentId: {
                  type: 'string',
                  description: 'The ID of the parent thought'
                },
                content: {
                  type: 'string',
                  description: 'The content of the child thought'
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata for the thought'
                }
              },
              required: ['treeId', 'parentId', 'content']
            }
          },
          {
            name: 'evaluate_thought',
            description: 'Evaluate a thought with a score (0-1 or 0-100) and optional multi-criteria fields',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to evaluate'
                },
                score: {
                  type: 'number',
                  description: 'The overall evaluation score',
                  minimum: 0,
                  maximum: 100
                },
                creativity: {
                  type: 'number',
                  description: 'Optional creativity score (0-100)',
                  minimum: 0,
                  maximum: 100
                },
                risk: {
                  type: 'number',
                  description: 'Optional risk score (0-100)',
                  minimum: 0,
                  maximum: 100
                },
                criteriaScores: {
                  type: 'object',
                  description: 'Optional map of custom criteria scores (e.g., { feasibility: 82, goal_alignment: 90 })',
                  additionalProperties: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100
                  }
                },
                reasoning: {
                  type: 'string',
                  description: 'Optional reasoning for the evaluation'
                }
              },
              required: ['treeId', 'thoughtId', 'score']
            }
          },
          {
            name: 'verify_thought',
            description: 'Mark a thought as verified after confirming its findings. Required before a thought can be selected.',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to verify'
                },
                verificationNotes: {
                  type: 'string',
                  description: 'Notes explaining how/why the thought was verified'
                }
              },
              required: ['treeId', 'thoughtId']
            }
          },
          {
            name: 'select_thought',
            description: 'Mark a thought as selected for further exploration (thought must be verified first)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to select'
                }
              },
              required: ['treeId', 'thoughtId']
            }
          },
          {
            name: 'backtrack',
            description: 'Backtrack from a thought, marking all descendants as pruned',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to backtrack from'
                }
              },
              required: ['treeId', 'thoughtId']
            }
          },
          {
            name: 'prune_tree',
            description: 'Prune thoughts below a certain evaluation threshold, optionally by risk threshold',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                threshold: {
                  type: 'number',
                  description: 'The evaluation threshold (thoughts below this will be pruned)'
                },
                riskThreshold: {
                  type: 'number',
                  description: 'Optional risk threshold (thoughts with risk above this will be pruned)'
                }
              },
              required: ['treeId', 'threshold']
            }
          },
          {
            name: 'get_thought',
            description: 'Get a specific thought by ID',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to retrieve'
                }
              },
              required: ['treeId', 'thoughtId']
            }
          },
          {
            name: 'get_tree_structure',
            description: 'Get the hierarchical structure of a tree',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'get_best_thoughts',
            description: 'Get the best evaluated thoughts in a tree, optionally sorted by criteria',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of thoughts to return (default: 5)'
                },
                sortBy: {
                  type: 'string',
                  description: 'Sort criteria: evaluation (default), creativity, risk, or combined',
                  enum: ['evaluation', 'creativity', 'risk', 'combined']
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'get_tree_stats',
            description: 'Get statistics about a tree',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'clear_all',
            description: 'Clear all trees',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'save_state',
            description: 'Manually save the current state to storage',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_version',
            description: 'Get the version information of this ToT MCP server',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'explore_with_strategy',
            description: 'Explore a thought tree using a systematic branching strategy (BFS, DFS, beam search, or best-first search)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to explore'
                },
                strategy: {
                  type: 'string',
                  enum: ['bfs', 'dfs', 'beam', 'best_first'],
                  description: 'The branching strategy to use'
                },
                maxThoughts: {
                  type: 'number',
                  description: 'Maximum number of thoughts to explore (default: 100)'
                },
                beamWidth: {
                  type: 'number',
                  description: 'Beam width for beam search strategy (default: 3)'
                },
                stopCriteria: {
                  type: 'object',
                  description: 'Optional stop criteria',
                  properties: {
                    minEvaluation: {
                      type: 'number',
                      description: 'Stop when a thought reaches this evaluation score'
                    },
                    maxDepth: {
                      type: 'number',
                      description: 'Stop when reaching this depth'
                    },
                    targetThoughtCount: {
                      type: 'number',
                      description: 'Stop when exploring this many thoughts'
                    }
                  }
                }
              },
              required: ['treeId', 'strategy']
            }
          },
          {
            name: 'propose_and_evaluate',
            description: 'Add a child thought and evaluate it in one call (auto-evaluation helper) with optional multi-criteria fields',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                parentId: {
                  type: 'string',
                  description: 'The ID of the parent thought'
                },
                content: {
                  type: 'string',
                  description: 'The content of the child thought'
                },
                score: {
                  type: 'number',
                  description: 'The overall evaluation score (0-100)',
                  minimum: 0,
                  maximum: 100
                },
                creativity: {
                  type: 'number',
                  description: 'Optional creativity score (0-100)',
                  minimum: 0,
                  maximum: 100
                },
                risk: {
                  type: 'number',
                  description: 'Optional risk score (0-100)',
                  minimum: 0,
                  maximum: 100
                },
                criteriaScores: {
                  type: 'object',
                  description: 'Optional map of custom criteria scores (e.g., { feasibility: 82, goal_alignment: 90 })',
                  additionalProperties: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100
                  }
                },
                reasoning: {
                  type: 'string',
                  description: 'Optional reasoning for the evaluation'
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata for the thought'
                }
              },
              required: ['treeId', 'parentId', 'content', 'score']
            }
          },
          {
            name: 'generate_children',
            description: 'Generate N diverse child thoughts for a parent thought (thought generation tool)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                parentId: {
                  type: 'string',
                  description: 'The ID of the parent thought'
                },
                numChildren: {
                  type: 'number',
                  description: 'Number of children to generate (default: 3)',
                  minimum: 1
                },
                diversityPrompt: {
                  type: 'string',
                  description: 'Optional prompt to encourage diverse thought generation'
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata for the thoughts'
                }
              },
              required: ['treeId', 'parentId', 'numChildren']
            }
          },
          {
            name: 'visualize_tree',
            description: 'Visualize a tree in human-readable format (ASCII, Mermaid, or DOT)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to visualize'
                },
                format: {
                  type: 'string',
                  enum: ['ascii', 'mermaid', 'dot'],
                  description: 'Output format (default: ascii)'
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'generate_and_evaluate_children',
            description: 'Generate child thoughts and evaluate them in one call using LLM judge',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                parentId: {
                  type: 'string',
                  description: 'The ID of the parent thought'
                },
                numChildren: {
                  type: 'number',
                  description: 'Number of children to generate (default: 3)',
                  minimum: 1
                },
                diversityPrompt: {
                  type: 'string',
                  description: 'Optional prompt to encourage diverse thought generation'
                },
                defaultScore: {
                  type: 'number',
                  description: 'Default score if LLM judge is not used (default: 50)',
                  minimum: 0,
                  maximum: 100
                },
                useLLMJudge: {
                  type: 'boolean',
                  description: 'Use LLM as judge for evaluation (requires LLM provider)'
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata for the thoughts'
                }
              },
              required: ['treeId', 'parentId', 'numChildren']
            }
          },
          {
            name: 'refine_thought',
            description: 'Refine a thought to better align with the goal using LLM',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to refine'
                }
              },
              required: ['treeId', 'thoughtId']
            }
          },
          {
            name: 'self_reflect_thought',
            description: 'Get a critique and improved version of a thought using LLM self-reflection',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                thoughtId: {
                  type: 'string',
                  description: 'The ID of the thought to reflect on'
                }
              },
              required: ['treeId', 'thoughtId']
            }
          },
          {
            name: 'suggest_next_actions',
            description: 'Get smart, context-aware recommendations about what to do next in a Tree of Thoughts session',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to analyze'
                },
                focusThoughtId: {
                  type: 'string',
                  description: 'Optional thought ID to focus recommendations on'
                },
                maxSuggestions: {
                  type: 'number',
                  description: 'Maximum number of suggestions to return (default: 5)',
                  minimum: 1
                }
              },
              required: ['treeId']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      await this.logRequest(name, args, { status: 'started' });

      try {
        switch (name) {
          case 'create_tree': {
            const goal = args?.goal as string;
            const rootContent = args?.rootContent as string;
            const maxDepth = args?.maxDepth as number | undefined;
            const metadata = args?.metadata as Record<string, any> | undefined;

            if (!goal || !rootContent) {
              throw new Error('goal and rootContent are required');
            }

            const tree = this.totService.createTree({
              goal,
              rootContent,
              maxDepth,
              metadata
            });

            await this.totService.save();

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
                      maxDepth: tree.maxDepth
                    }
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_tree': {
            const treeId = args?.treeId as string;
            if (!treeId) {
              throw new Error('treeId is required');
            }

            const tree = this.totService.getTree(treeId);
            
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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'list_trees': {
            const trees = this.totService.getAllTrees();

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'delete_tree': {
            const treeId = args?.treeId as string;
            if (!treeId) {
              throw new Error('treeId is required');
            }

            const deleted = this.totService.deleteTree(treeId);
            
            if (!deleted) {
              throw new Error('Tree not found');
            }

            await this.totService.save();

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'add_child': {
            const treeId = args?.treeId as string;
            const parentId = args?.parentId as string;
            const content = args?.content as string;
            const metadata = args?.metadata as Record<string, any> | undefined;

            if (!treeId || !parentId || !content) {
              throw new Error('treeId, parentId, and content are required');
            }

            const thought = this.totService.addChildThought({
              treeId,
              parentId,
              content,
              metadata
            });
            
            if (!thought) {
              throw new Error('Tree or parent thought not found');
            }

            await this.totService.save();

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
                      depth: thought.depth
                    }
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'evaluate_thought': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;
            const score = args?.score as number;
            const creativity = args?.creativity as number | undefined;
            const risk = args?.risk as number | undefined;
            const criteriaScores = args?.criteriaScores as Record<string, number> | undefined;
            const reasoning = args?.reasoning as string | undefined;

            if (!treeId || !thoughtId || score === undefined) {
              throw new Error('treeId, thoughtId, and score are required');
            }

            const thought = this.totService.evaluateThought({
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

            await this.totService.save();

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'verify_thought': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;
            const verificationNotes = args?.verificationNotes as string | undefined;

            if (!treeId || !thoughtId) {
              throw new Error('treeId and thoughtId are required');
            }

            const thought = this.totService.verifyThought({
              treeId,
              thoughtId,
              verificationNotes
            });

            if (!thought) {
              throw new Error('Tree or thought not found');
            }

            await this.totService.save();

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'select_thought': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;

            if (!treeId || !thoughtId) {
              throw new Error('treeId and thoughtId are required');
            }

            const thought = this.totService.selectThought({
              treeId,
              thoughtId
            });
            
            if (!thought) {
              throw new Error('Tree or thought not found');
            }

            await this.totService.save();

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'backtrack': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;

            if (!treeId || !thoughtId) {
              throw new Error('treeId and thoughtId are required');
            }

            const thought = this.totService.backtrack({
              treeId,
              thoughtId
            });
            
            if (!thought) {
              throw new Error('Tree or thought not found');
            }

            await this.totService.save();

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'prune_tree': {
            const treeId = args?.treeId as string;
            const threshold = args?.threshold as number;
            const riskThreshold = args?.riskThreshold as number | undefined;

            if (!treeId || threshold === undefined) {
              throw new Error('treeId and threshold are required');
            }

            const result = this.totService.pruneTree({
              treeId,
              threshold,
              riskThreshold
            });

            await this.totService.save();

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
            await this.logRequest(name, args, output);
            return output;
          }

          case 'get_thought': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;

            if (!treeId || !thoughtId) {
              throw new Error('treeId and thoughtId are required');
            }

            const thought = this.totService.getThought(treeId, thoughtId);
            
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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_tree_structure': {
            const treeId = args?.treeId as string;
            if (!treeId) {
              throw new Error('treeId is required');
            }

            const structure = this.totService.getTreeStructure(treeId);
            
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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_best_thoughts': {
            const treeId = args?.treeId as string;
            const limit = args?.limit as number | undefined;
            const sortBy = args?.sortBy as 'evaluation' | 'creativity' | 'risk' | 'combined' | undefined;

            if (!treeId) {
              throw new Error('treeId is required');
            }

            const thoughts = this.totService.getBestThoughts(treeId, limit, sortBy);

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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_tree_stats': {
            const treeId = args?.treeId as string;
            if (!treeId) {
              throw new Error('treeId is required');
            }

            const stats = this.totService.getTreeStats(treeId);
            
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
            await this.logRequest(name, args, result);
            return result;
          }

          case 'clear_all': {
            this.totService.clearAll();
            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'All trees cleared'
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'save_state': {
            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'State saved successfully'
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_version': {
            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    name: 'tot',
                    version: '1.0.0',
                    description: 'Tree of Thoughts (ToT) MCP server for structured reasoning and decision tree exploration',
                    features: ['thought_trees', 'evaluation', 'backtracking', 'pruning', 'best_path_selection', 'persistent_storage', 'branching_strategies', 'visualization']
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'explore_with_strategy': {
            const treeId = args?.treeId as string;
            const strategy = args?.strategy as string;
            const maxThoughts = args?.maxThoughts as number | undefined;
            const beamWidth = args?.beamWidth as number | undefined;
            const stopCriteria = args?.stopCriteria as Record<string, any> | undefined;

            if (!treeId || !strategy) {
              throw new Error('treeId and strategy are required');
            }

            const validStrategies = ['bfs', 'dfs', 'beam', 'best_first'];
            if (!validStrategies.includes(strategy)) {
              throw new Error(`Invalid strategy. Must be one of: ${validStrategies.join(', ')}`);
            }

            const result = this.totService.exploreWithStrategy({
              treeId,
              strategy: strategy as any,
              maxThoughts,
              beamWidth,
              stopCriteria
            });

            await this.totService.save();

            const output = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Exploration completed successfully',
                    result
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, output);
            return output;
          }

          case 'propose_and_evaluate': {
            const treeId = args?.treeId as string;
            const parentId = args?.parentId as string;
            const content = args?.content as string;
            const score = args?.score as number;
            const creativity = args?.creativity as number | undefined;
            const risk = args?.risk as number | undefined;
            const criteriaScores = args?.criteriaScores as Record<string, number> | undefined;
            const reasoning = args?.reasoning as string | undefined;
            const metadata = args?.metadata as Record<string, any> | undefined;

            if (!treeId || !parentId || !content || score === undefined) {
              throw new Error('treeId, parentId, content, and score are required');
            }

            const thought = this.totService.proposeAndEvaluate({
              treeId,
              parentId,
              content,
              score,
              creativity,
              risk,
              criteriaScores,
              reasoning,
              metadata
            });

            if (!thought) {
              throw new Error('Tree or parent thought not found');
            }

            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Thought proposed and evaluated successfully',
                    thought: {
                      id: thought.id,
                      content: thought.content,
                      evaluation: thought.evaluation,
                      state: thought.state,
                      depth: thought.depth
                    }
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'generate_children': {
            const treeId = args?.treeId as string;
            const parentId = args?.parentId as string;
            const numChildren = args?.numChildren as number;
            const diversityPrompt = args?.diversityPrompt as string | undefined;
            const metadata = args?.metadata as Record<string, any> | undefined;

            if (!treeId || !parentId || numChildren === undefined) {
              throw new Error('treeId, parentId, and numChildren are required');
            }

            const children = await this.totService.generateChildren({
              treeId,
              parentId,
              numChildren,
              diversityPrompt,
              metadata
            });

            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Children generated successfully',
                    children,
                    count: children.length
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'visualize_tree': {
            const treeId = args?.treeId as string;
            const format = args?.format as string | undefined;

            if (!treeId) {
              throw new Error('treeId is required');
            }

            const visualization = this.totService.visualizeTree({
              treeId,
              format: format as any
            });

            const result = {
              content: [
                {
                  type: 'text',
                  text: visualization
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'generate_and_evaluate_children': {
            const treeId = args?.treeId as string;
            const parentId = args?.parentId as string;
            const numChildren = args?.numChildren as number;
            const diversityPrompt = args?.diversityPrompt as string | undefined;
            const defaultScore = args?.defaultScore as number | undefined;
            const useLLMJudge = args?.useLLMJudge as boolean | undefined;
            const metadata = args?.metadata as Record<string, any> | undefined;

            if (!treeId || !parentId || numChildren === undefined) {
              throw new Error('treeId, parentId, and numChildren are required');
            }

            const children = await this.totService.generateChildrenAndEvaluate(
              {
                treeId,
                parentId,
                numChildren,
                diversityPrompt,
                metadata
              },
              defaultScore,
              useLLMJudge
            );

            await this.totService.save();

            // Get full thought details including evaluation
            const tree = this.totService.getTree(treeId);
            const childrenWithDetails = children.map(child => {
              const thought = tree?.thoughts.get(child.thoughtId);
              return {
                thoughtId: child.thoughtId,
                content: child.content,
                depth: child.depth,
                evaluation: thought?.evaluation,
                creativity: thought?.creativity,
                risk: thought?.risk,
                criteriaScores: thought?.criteriaScores,
                state: thought?.state
              };
            });

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Children generated and evaluated successfully',
                    children: childrenWithDetails,
                    count: children.length
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'refine_thought': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;

            if (!treeId || !thoughtId) {
              throw new Error('treeId and thoughtId are required');
            }

            const tree = this.totService.getTree(treeId);
            if (!tree) {
              throw new Error('Tree not found');
            }

            const thought = tree.thoughts.get(thoughtId);
            if (!thought) {
              throw new Error('Thought not found');
            }

            const refinedContent = await this.totService.refineThought(treeId, thoughtId);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Thought refined successfully',
                    originalContent: thought.content,
                    refinedContent
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'self_reflect_thought': {
            const treeId = args?.treeId as string;
            const thoughtId = args?.thoughtId as string;
            const feedback = args?.feedback as string;

            if (!treeId || !thoughtId) {
              throw new Error('treeId and thoughtId are required');
            }

            const tree = this.totService.getTree(treeId);
            if (!tree) {
              throw new Error('Tree not found');
            }

            const thought = tree.thoughts.get(thoughtId);
            if (!thought) {
              throw new Error('Thought not found');
            }

            const reflectionResult = await this.totService.selfReflectThought(treeId, thoughtId, feedback);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Self-reflection completed successfully',
                    originalContent: thought.content,
                    critique: reflectionResult.critique,
                    feedback: feedback || 'Critique this thought and suggest improvements'
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'suggest_next_actions': {
            const treeId = args?.treeId as string;
            const focusThoughtId = args?.focusThoughtId as string | undefined;
            const maxSuggestions = args?.maxSuggestions as number | undefined;

            if (!treeId) {
              throw new Error('treeId is required');
            }

            const suggestions = this.totService.suggestNextActions(treeId, focusThoughtId, maxSuggestions);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Next action suggestions generated successfully',
                    suggestions,
                    count: suggestions.length
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorType = error instanceof Error ? error.constructor.name : 'Error';
        
        logger.error(`Tool ${name} failed: ${errorMessage}`);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: {
                  message: errorMessage,
                  type: errorType,
                  timestamp: new Date().toISOString()
                }
              }, null, 2)
            }
          ]
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('ToT MCP server running on stdio');
  }
}

const server = new ToTMCPServer();
server.run().catch(err => logger.error(`Server error: ${err instanceof Error ? err.message : String(err)}`));
