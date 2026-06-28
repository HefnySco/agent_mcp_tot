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
import { OllamaLLMProvider } from './llm-providers/ollama-llm-provider.js';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import * as treeHandlers from './handlers/treeHandlers.js';
import * as thoughtHandlers from './handlers/thoughtHandlers.js';
import * as queryHandlers from './handlers/queryHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');


function createLLMProvider(): ToTServiceConfig {
  const providerType = process.env.LLM_PROVIDER_TYPE || 'mock';
  const grokApiKey = process.env.GROK_API_KEY;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama2';

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

  if (providerType === 'ollama') {
    logger.info(`Using OllamaLLMProvider at ${ollamaBaseUrl} with model ${ollamaModel}`);
    return { llmProvider: new OllamaLLMProvider(ollamaBaseUrl, ollamaModel) };
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
                sessionId: {
                  type: 'string',
                  description: 'Optional session ID for context maintenance and grouping related trees'
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
                sessionId: {
                  type: 'string',
                  description: 'Optional session ID for context maintenance'
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
            name: 'move_subtree',
            description: 'Move a subtree to a new parent within the same tree. Performs cycle detection, depth validation, and supports dry-run mode for safe preview.',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree'
                },
                subtreeRootId: {
                  type: 'string',
                  description: 'The ID of the subtree root to move'
                },
                newParentId: {
                  type: 'string',
                  description: 'The ID of the new parent thought'
                },
                dryRun: {
                  type: 'boolean',
                  description: 'If true, preview the move without making changes (default: false)'
                }
              },
              required: ['treeId', 'subtreeRootId', 'newParentId']
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
            name: 'clear_tree',
            description: 'Clear a specific tree by ID',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to clear'
                }
              },
              required: ['treeId']
            }
          },
          {
            name: 'clear_strategy',
            description: 'Clear a specific strategy by ID',
            inputSchema: {
              type: 'object',
              properties: {
                strategyId: {
                  type: 'string',
                  description: 'The ID of the strategy to clear'
                }
              },
              required: ['strategyId']
            }
          },
          {
            name: 'clear_everything',
            description: 'Clear all trees and strategies',
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
            description: 'Visualize a tree in human-readable format (ASCII, Mermaid, DOT, PNG, or SVG)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to visualize'
                },
                format: {
                  type: 'string',
                  enum: ['ascii', 'mermaid', 'dot', 'png', 'svg'],
                  description: 'Output format (default: ascii). PNG and SVG return base64-encoded image data.'
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
            description: "Use this tool when you are unsure what to do next in the Tree of Thoughts process. It analyzes the current state of the tree (pending thoughts, low evaluations, high risk branches, depth progress, etc.) and returns prioritized, actionable recommendations such as: generate children, evaluate thoughts, prune low-value branches, verify good thoughts, backtrack, or use exploration strategies. Call this tool proactively when the tree feels stuck, has many pending items, or you need guidance on the best next step.",
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
          },
          {
            name: 'list_trees_by_session',
            description: 'List all trees associated with a specific session ID for context maintenance',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'The session ID to filter trees by'
                }
              },
              required: ['sessionId']
            }
          },
          {
            name: 'delete_session_trees',
            description: 'Delete all trees and thoughts associated with a specific session ID for cleanup',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'The session ID to delete trees for'
                }
              },
              required: ['sessionId']
            }
          },
          {
            name: 'get_session_context',
            description: 'Get all thoughts across all trees for a specific session ID to understand the full context',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'The session ID to get context for'
                }
              },
              required: ['sessionId']
            }
          },
          {
            name: 'create_strategy',
            description: 'Create a new Strategy for grouping related trees for long-term reasoning initiatives',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Human-friendly name for the strategy'
                },
                description: {
                  type: 'string',
                  description: 'Optional description of the strategy'
                }
              },
              required: ['name']
            }
          },
          {
            name: 'list_strategies',
            description: 'List all strategies, optionally filtered by status',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  description: 'Optional status filter (active, paused, completed, archived)',
                  enum: ['active', 'paused', 'completed', 'archived']
                }
              }
            }
          },
          {
            name: 'get_strategy',
            description: 'Get a strategy by ID or name (case-insensitive)',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID or name of the strategy'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'move_tree_to_strategy',
            description: 'Move a tree to a strategy (lightweight operation that preserves original tree IDs)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to move'
                },
                strategyIdOrName: {
                  type: 'string',
                  description: 'The ID or name of the target strategy'
                }
              },
              required: ['treeId', 'strategyIdOrName']
            }
          },
          {
            name: 'clone_tree_to_strategy',
            description: 'Clone a tree into a strategy (deep copy with new IDs for tree and all thoughts)',
            inputSchema: {
              type: 'object',
              properties: {
                treeId: {
                  type: 'string',
                  description: 'The ID of the tree to clone'
                },
                strategyIdOrName: {
                  type: 'string',
                  description: 'The ID or name of the target strategy'
                },
                namePrefix: {
                  type: 'string',
                  description: 'Optional prefix to add to the cloned tree goal'
                }
              },
              required: ['treeId', 'strategyIdOrName']
            }
          },
          {
            name: 'list_trees_by_strategy',
            description: 'List all trees belonging to a strategy (by ID or name)',
            inputSchema: {
              type: 'object',
              properties: {
                strategyIdOrName: {
                  type: 'string',
                  description: 'The ID or name of the strategy'
                }
              },
              required: ['strategyIdOrName']
            }
          },
          {
            name: 'get_strategy_context',
            description: 'Get a strategy with its trees and basic statistics (aggregated view across trees in the strategy)',
            inputSchema: {
              type: 'object',
              properties: {
                strategyIdOrName: {
                  type: 'string',
                  description: 'The ID or name of the strategy'
                }
              },
              required: ['strategyIdOrName']
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
          case 'create_tree':
            return treeHandlers.handleCreateTree(this.totService, args, this.logRequest.bind(this));

          case 'get_tree':
            return treeHandlers.handleGetTree(this.totService, args, this.logRequest.bind(this));

          case 'list_trees':
            return treeHandlers.handleListTrees(this.totService, args, this.logRequest.bind(this));

          case 'delete_tree':
            return treeHandlers.handleDeleteTree(this.totService, args, this.logRequest.bind(this));

          case 'clear_tree':
            return treeHandlers.handleClearTree(this.totService, args, this.logRequest.bind(this));

          case 'add_child':
            return thoughtHandlers.handleAddChild(this.totService, args, this.logRequest.bind(this));

          case 'evaluate_thought':
            return thoughtHandlers.handleEvaluateThought(this.totService, args, this.logRequest.bind(this));

          case 'verify_thought':
            return thoughtHandlers.handleVerifyThought(this.totService, args, this.logRequest.bind(this));

          case 'select_thought':
            return thoughtHandlers.handleSelectThought(this.totService, args, this.logRequest.bind(this));

          case 'backtrack':
            return thoughtHandlers.handleBacktrack(this.totService, args, this.logRequest.bind(this));

          case 'prune_tree':
            return thoughtHandlers.handlePruneTree(this.totService, args, this.logRequest.bind(this));

          case 'move_subtree':
            return thoughtHandlers.handleMoveSubtree(this.totService, args, this.logRequest.bind(this));

          case 'get_thought':
            return queryHandlers.handleGetThought(this.totService, args, this.logRequest.bind(this));

          case 'get_tree_structure':
            return queryHandlers.handleGetTreeStructure(this.totService, args, this.logRequest.bind(this));

          case 'get_best_thoughts':
            return queryHandlers.handleGetBestThoughts(this.totService, args, this.logRequest.bind(this));

          case 'get_tree_stats':
            return queryHandlers.handleGetTreeStats(this.totService, args, this.logRequest.bind(this));

          case 'clear_everything': {
            this.totService.clearEverything();
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

            const visualization = await this.totService.visualizeTree({
              treeId,
              format: format as any
            });

            // For PNG/SVG formats, the visualization is a JSON string with base64 data
            // For text formats (ascii, mermaid, dot), it's plain text
            const isImageFormat = format === 'png' || format === 'svg';
            
            if (isImageFormat) {
              const renderResult = JSON.parse(visualization);
              const result = {
                content: [
                  {
                    type: 'image',
                    data: renderResult.data,
                    mimeType: renderResult.mimeType
                  }
                ]
              };
              await this.logRequest(name, args, result);
              return result;
            } else {
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

          case 'list_trees_by_session': {
            const sessionId = args?.sessionId as string;
            if (!sessionId) {
              throw new Error('sessionId is required');
            }

            const trees = this.totService.getTreesBySession(sessionId);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Trees retrieved successfully',
                    sessionId,
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

          case 'delete_session_trees': {
            const sessionId = args?.sessionId as string;
            if (!sessionId) {
              throw new Error('sessionId is required');
            }

            const deletedCount = this.totService.deleteSession(sessionId);
            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Session trees deleted successfully',
                    sessionId,
                    deletedCount
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_session_context': {
            const sessionId = args?.sessionId as string;
            if (!sessionId) {
              throw new Error('sessionId is required');
            }

            const thoughts = this.totService.getThoughtsBySession(sessionId);
            const trees = this.totService.getTreesBySession(sessionId);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Session context retrieved successfully',
                    sessionId,
                    trees: trees.map(t => ({
                      id: t.id,
                      goal: t.goal,
                      thoughtCount: t.thoughts.size
                    })),
                    thoughts: thoughts.map(t => ({
                      id: t.id,
                      content: t.content,
                      treeId: trees.find(tree => tree.thoughts.has(t.id))?.id,
                      evaluation: t.evaluation,
                      state: t.state,
                      depth: t.depth
                })),
                totalThoughts: thoughts.length,
                totalTrees: trees.length
              }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'create_strategy': {
            const name = args?.name as string;
            const description = args?.description as string | undefined;

            if (!name) {
              throw new Error('name is required');
            }

            const strategy = this.totService.createStrategy(name, description);
            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Strategy created successfully',
                    strategy: {
                      id: strategy.id,
                      name: strategy.name,
                      description: strategy.description,
                      status: strategy.status,
                      treeIds: strategy.treeIds,
                      createdAt: strategy.createdAt,
                      updatedAt: strategy.updatedAt
                    }
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'list_strategies': {
            const status = args?.status as string | undefined;
            const strategies = this.totService.listStrategies(status);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Strategies retrieved successfully',
                    strategies: strategies.map(s => ({
                      id: s.id,
                      name: s.name,
                      description: s.description,
                      status: s.status,
                      treeCount: s.treeIds.length,
                      createdAt: s.createdAt,
                      updatedAt: s.updatedAt
                    })),
                    count: strategies.length
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'get_strategy': {
            const id = args?.id as string;
            if (!id) {
              throw new Error('id is required');
            }

            const strategy = this.totService.getStrategy(id);
            if (!strategy) {
              throw new Error(`Strategy not found: ${id}`);
            }

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Strategy retrieved successfully',
                    strategy: {
                      id: strategy.id,
                      name: strategy.name,
                      description: strategy.description,
                      status: strategy.status,
                      treeIds: strategy.treeIds,
                      createdAt: strategy.createdAt,
                      updatedAt: strategy.updatedAt,
                      metadata: strategy.metadata
                    }
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'move_tree_to_strategy': {
            const treeId = args?.treeId as string;
            const strategyIdOrName = args?.strategyIdOrName as string;

            if (!treeId || !strategyIdOrName) {
              throw new Error('treeId and strategyIdOrName are required');
            }

            this.totService.moveTreeToStrategy(treeId, strategyIdOrName);
            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Tree moved to strategy successfully',
                    treeId,
                    strategyIdOrName
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'clone_tree_to_strategy': {
            const treeId = args?.treeId as string;
            const strategyIdOrName = args?.strategyIdOrName as string;
            const namePrefix = args?.namePrefix as string | undefined;

            if (!treeId || !strategyIdOrName) {
              throw new Error('treeId and strategyIdOrName are required');
            }

            const result = this.totService.cloneTreeToStrategy(treeId, strategyIdOrName, { namePrefix });
            await this.totService.save();

            const response = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Tree cloned to strategy successfully',
                    newTreeId: result.newTreeId,
                    originalTreeId: treeId,
                    strategyIdOrName
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, response);
            return response;
          }

          case 'list_trees_by_strategy': {
            const strategyIdOrName = args?.strategyIdOrName as string;
            if (!strategyIdOrName) {
              throw new Error('strategyIdOrName is required');
            }

            const trees = this.totService.getTreesByStrategy(strategyIdOrName);

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Trees retrieved successfully',
                    strategyIdOrName,
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

          case 'get_strategy_context': {
            const strategyIdOrName = args?.strategyIdOrName as string;
            if (!strategyIdOrName) {
              throw new Error('strategyIdOrName is required');
            }

            const context = this.totService.getStrategyWithTrees(strategyIdOrName);
            if (!context) {
              throw new Error(`Strategy not found: ${strategyIdOrName}`);
            }

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Strategy context retrieved successfully',
                    strategy: {
                      id: context.strategy.id,
                      name: context.strategy.name,
                      description: context.strategy.description,
                      status: context.strategy.status
                    },
                    stats: context.stats,
                    trees: context.trees.map(t => ({
                      id: t.id,
                      goal: t.goal,
                      thoughtCount: t.thoughts.size
                    })),
                    treeCount: context.trees.length
                  }, null, 2)
                }
              ]
            };
            await this.logRequest(name, args, result);
            return result;
          }

          case 'clear_strategy': {
            const strategyId = args?.strategyId as string;
            if (!strategyId) {
              throw new Error('strategyId is required');
            }

            const cleared = this.totService.clearStrategy(strategyId);
            
            if (!cleared) {
              throw new Error('Strategy not found');
            }

            await this.totService.save();

            const result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Strategy cleared successfully',
                    strategyId
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

// Only start the server when this file is executed directly (not when imported by tests)
const isMainModule = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const server = new ToTMCPServer();
  server.run().catch(err => logger.error(`Server error: ${err instanceof Error ? err.message : String(err)}`));
}
