import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ToTService, ToTServiceConfig, LLMProvider } from '../src/totService.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_STORAGE_PATH = path.join(__dirname, 'test-storage.json');

describe('ToTService', () => {
  let service: ToTService;

  before(async () => {
    try {
      await fs.unlink(TEST_STORAGE_PATH);
    } catch (err) {
      // File doesn't exist, that's fine
    }
    service = new ToTService(TEST_STORAGE_PATH);
    await service.load();
  });

  beforeEach(() => {
    // Clear strategies and trees before each test to avoid accumulation
    (service as any).strategies.clear();
    (service as any).trees.clear();
  });

  after(async () => {
    try {
      await fs.unlink(TEST_STORAGE_PATH);
    } catch (err) {
      // File doesn't exist, that's fine
    }
  });

  describe('createTree', () => {
    it('should create a tree with root thought', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      assert.ok(tree.id);
      assert.strictEqual(tree.goal, 'Test goal');
      assert.strictEqual(tree.rootId, tree.thoughts.get(tree.rootId)?.id);
      assert.strictEqual(tree.thoughts.size, 1);
    });

    it('should create tree with maxDepth', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought',
        maxDepth: 5
      });

      assert.strictEqual(tree.maxDepth, 5);
    });

    it('should create tree with metadata', () => {
      const metadata = { key: 'value' };
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought',
        metadata
      });

      assert.deepStrictEqual(tree.metadata, metadata);
    });
  });

  describe('addChildThought', () => {
    it('should add child thought to parent', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child thought'
      });

      assert.ok(child);
      assert.ok(child.id);
      assert.strictEqual(child.content, 'Child thought');
      assert.strictEqual(child.parentId, tree.rootId);
      assert.strictEqual(child.depth, 1);
      assert.strictEqual(tree.thoughts.size, 2);
    });

    it('should throw error for non-existent tree', () => {
      assert.throws(() => {
        service.addChildThought({
          treeId: 'non-existent',
          parentId: 'some-id',
          content: 'Child thought'
        });
      }, /Tree not found/);
    });

    it('should throw error for non-existent parent', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      assert.throws(() => {
        service.addChildThought({
          treeId: tree.id,
          parentId: 'non-existent',
          content: 'Child thought'
        });
      }, /Thought not found/);
    });

    it('should throw error when maxDepth is reached', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought',
        maxDepth: 1
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child thought'
      });

      assert.ok(child); // First child should succeed (depth 1)
      assert.ok(child.id);

      assert.throws(() => {
        service.addChildThought({
          treeId: tree.id,
          parentId: child.id,
          content: 'Grandchild thought'
        });
      }, /Maximum depth reached/);
    });
  });

  describe('evaluateThought', () => {
    it('should evaluate a thought with score', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const thought = service.evaluateThought({
        treeId: tree.id,
        thoughtId: tree.rootId,
        score: 75
      });

      assert.ok(thought);
      assert.strictEqual(thought.evaluation, 75);
      assert.strictEqual(thought.state, 'evaluated');
    });

    it('should throw error for invalid score', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      assert.throws(() => {
        service.evaluateThought({
          treeId: tree.id,
          thoughtId: tree.rootId,
          score: 150
        });
      }, /score must be between 0 and 100/);
    });

    it('should store reasoning in metadata', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const thought = service.evaluateThought({
        treeId: tree.id,
        thoughtId: tree.rootId,
        score: 75,
        reasoning: 'Test reasoning'
      });

      assert.ok(thought);
      assert.strictEqual(thought.metadata?.evaluationReasoning, 'Test reasoning');
    });

    it('should store creativity and risk fields', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const thought = service.evaluateThought({
        treeId: tree.id,
        thoughtId: tree.rootId,
        score: 75,
        creativity: 85,
        risk: 30,
        criteriaScores: { feasibility: 90, impact: 80 }
      });

      assert.ok(thought);
      assert.strictEqual(thought.creativity, 85);
      assert.strictEqual(thought.risk, 30);
      assert.deepStrictEqual(thought.criteriaScores, { feasibility: 90, impact: 80 });
    });
  });

  describe('verifyThought', () => {
    it('should mark thought as verified', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const thought = service.verifyThought({
        treeId: tree.id,
        thoughtId: tree.rootId,
        verificationNotes: 'Test notes'
      });

      assert.ok(thought);
      assert.strictEqual(thought.verified, true);
      assert.strictEqual(thought.verificationNotes, 'Test notes');
    });
  });

  describe('selectThought', () => {
    it('should select verified thought', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      service.verifyThought({
        treeId: tree.id,
        thoughtId: tree.rootId
      });

      const thought = service.selectThought({
        treeId: tree.id,
        thoughtId: tree.rootId
      });

      assert.ok(thought);
      assert.strictEqual(thought.state, 'selected');
    });

    it('should throw error for unverified thought', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      assert.throws(() => {
        service.selectThought({
          treeId: tree.id,
          thoughtId: tree.rootId
        });
      }, /Cannot select unverified thought/);
    });
  });

  describe('backtrack', () => {
    it('should mark descendants as pruned', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      assert.ok(child1);
      assert.ok(child2);

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1.id!,
        content: 'Grandchild'
      });

      service.backtrack({
        treeId: tree.id,
        thoughtId: child1.id!
      });

      assert.ok(grandchild);
      assert.ok(child1);
      assert.ok(child2);
      assert.strictEqual(tree.thoughts.get(grandchild.id)?.state, 'pruned');
      assert.strictEqual(tree.thoughts.get(child1.id)?.state, 'pending');
      assert.strictEqual(tree.thoughts.get(child2.id)?.state, 'pending');
    });
  });

  describe('pruneTree', () => {
    it('should prune thoughts below threshold', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      assert.ok(child1);
      assert.ok(child2);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id!,
        score: 30
      });

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child2.id!,
        score: 80
      });

      const result = service.pruneTree({
        treeId: tree.id,
        threshold: 50
      });

      assert.strictEqual(result.prunedCount, 1);
      assert.strictEqual(tree.thoughts.get(child1.id!)?.state, 'pruned');
      assert.strictEqual(tree.thoughts.get(child2.id!)?.state, 'evaluated');
    });

    it('should prune thoughts above risk threshold', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      assert.ok(child1);
      assert.ok(child2);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id!,
        score: 80,
        risk: 85
      });

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child2.id!,
        score: 75,
        risk: 20
      });

      const result = service.pruneTree({
        treeId: tree.id,
        threshold: 50,
        riskThreshold: 70
      });

      assert.strictEqual(result.prunedCount, 1);
      assert.strictEqual(tree.thoughts.get(child1.id!)?.state, 'pruned');
      assert.strictEqual(tree.thoughts.get(child2.id!)?.state, 'evaluated');
    });
  });

  describe('getTreeStats', () => {
    it('should return tree statistics', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      assert.ok(child1);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id!,
        score: 75
      });

      const stats = service.getTreeStats(tree.id);

      assert.ok(stats);
      assert.strictEqual(stats.totalThoughts, 2);
      assert.strictEqual(stats.evaluatedThoughts, 1);
      assert.strictEqual(stats.averageEvaluation, 75);
    });

    it('should calculate average creativity and risk', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      assert.ok(child1);
      assert.ok(child2);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id!,
        score: 75,
        creativity: 80,
        risk: 30
      });

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child2.id!,
        score: 85,
        creativity: 60,
        risk: 50
      });

      const stats = service.getTreeStats(tree.id);

      assert.ok(stats);
      assert.strictEqual(stats.averageCreativity, 70);
      assert.strictEqual(stats.averageRisk, 40);
    });
  });

  describe('persistence', () => {
    it('should save and load trees', async () => {
      const tree = service.createTree({
        goal: 'Persistence test',
        rootContent: 'Test root'
      });

      await service.save();

      const newService = new ToTService(TEST_STORAGE_PATH);
      await newService.load();

      const loadedTree = newService.getTree(tree.id);
      assert.ok(loadedTree);
      assert.strictEqual(loadedTree.goal, 'Persistence test');
      assert.strictEqual(loadedTree.thoughts.size, 1);
    });

    it('should create storage file if not found', async () => {
      const newStoragePath = path.join(__dirname, 'test-new-storage.json');
      try {
        await fs.unlink(newStoragePath);
      } catch (err) {
        // File doesn't exist, that's fine
      }

      const newService = new ToTService(newStoragePath);
      await newService.load();

      // Verify file was created with empty structure
      const data = await fs.readFile(newStoragePath, 'utf-8');
      const parsed = JSON.parse(data);
      assert.ok(parsed.trees);
      assert.deepStrictEqual(parsed.trees, {});

      // Cleanup
      try {
        await fs.unlink(newStoragePath);
      } catch (err) {
        // Ignore cleanup errors
      }
    });

    it('should handle corrupt storage file gracefully', async () => {
      await fs.writeFile(TEST_STORAGE_PATH, 'invalid json');

      const newService = new ToTService(TEST_STORAGE_PATH);
      await newService.load();

      assert.strictEqual(newService.getAllTrees().length, 0);
    });

    it('should use atomic writes', async () => {
      const tree = service.createTree({
        goal: 'Atomic test',
        rootContent: 'Test root'
      });

      await service.save();

      const data = await fs.readFile(TEST_STORAGE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      assert.ok(parsed.trees);
      assert.ok(parsed.trees[tree.id]);
    });
  });

  describe('LLM integration', () => {
    it('should accept LLM provider config', () => {
      const mockLLMProvider: LLMProvider = {
        generateThoughts: async (prompt: string, count: number, context?: string) => {
          return Array.from({ length: count }, (_, i) => `Thought ${i + 1}`);
        }
      };

      const config: ToTServiceConfig = {
        llmProvider: mockLLMProvider
      };
      const configService = new ToTService(TEST_STORAGE_PATH, config);

      assert.ok(configService);
    });

    it('should use placeholder when LLM provider not configured', async () => {
      const tree = service.createTree({
        goal: 'LLM test',
        rootContent: 'Test root'
      });

      const children = await service.generateChildren({
        treeId: tree.id,
        parentId: tree.rootId,
        numChildren: 2
      });

      assert.strictEqual(children.length, 2);
      assert.ok(children[0].content.includes('LLM provider not configured'));
    });

    it('should throw error in strict mode when LLM not configured', async () => {
      const strictService = new ToTService(TEST_STORAGE_PATH, {
        strictLLM: true
      });

      const tree = strictService.createTree({
        goal: 'Strict LLM test',
        rootContent: 'Test root'
      });

      await assert.rejects(
        async () => {
          await strictService.generateChildren({
            treeId: tree.id,
            parentId: tree.rootId,
            numChildren: 2
          });
        },
        /LLM provider not configured/
      );
    });

    it('should use LLM provider when configured', async () => {
      const mockLLMProvider: LLMProvider = {
        generateThoughts: async (prompt: string, count: number, context?: string) => {
          return Array.from({ length: count }, (_, i) => `AI Thought ${i + 1}`);
        }
      };

      const config: ToTServiceConfig = {
        llmProvider: mockLLMProvider
      };
      const configService = new ToTService(TEST_STORAGE_PATH, config);

      const tree = configService.createTree({
        goal: 'LLM test',
        rootContent: 'Test root'
      });

      const children = await configService.generateChildren({
        treeId: tree.id,
        parentId: tree.rootId,
        numChildren: 2
      });

      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].content, 'AI Thought 1');
      assert.strictEqual(children[1].content, 'AI Thought 2');
    });

    it('should generate children and evaluate with default score', async () => {
      const mockLLMProvider: LLMProvider = {
        generateThoughts: async (prompt: string, count: number, context?: string) => {
          return Array.from({ length: count }, (_, i) => `AI Thought ${i + 1}`);
        }
      };

      const config: ToTServiceConfig = {
        llmProvider: mockLLMProvider
      };
      const configService = new ToTService(TEST_STORAGE_PATH, config);

      const tree = configService.createTree({
        goal: 'LLM test',
        rootContent: 'Test root'
      });

      const children = await configService.generateChildrenAndEvaluate({
        treeId: tree.id,
        parentId: tree.rootId,
        numChildren: 2
      }, 75);

      assert.strictEqual(children.length, 2);
      
      const child1 = configService.getThought(tree.id, children[0].thoughtId);
      const child2 = configService.getThought(tree.id, children[1].thoughtId);
      
      assert.ok(child1);
      assert.ok(child2);
      assert.strictEqual(child1.evaluation, 75);
      assert.strictEqual(child1.state, 'evaluated');
      assert.strictEqual(child2.evaluation, 75);
      assert.strictEqual(child2.state, 'evaluated');
    });

    it('should generate children and evaluate with LLM judge', async () => {
      const mockLLMProvider: LLMProvider = {
        generateThoughts: async (prompt: string, count: number, context?: string) => {
          if (prompt.includes('expert evaluator')) {
            return ['Score: 87\nCreativity: 75\nRisk: 25\nReasoning: This path looks promising because it addresses the core problem directly.'];
          }
          return Array.from({ length: count }, (_, i) => `AI Thought ${i + 1}`);
        }
      };

      const config: ToTServiceConfig = {
        llmProvider: mockLLMProvider
      };
      const configService = new ToTService(TEST_STORAGE_PATH, config);

      const tree = configService.createTree({
        goal: 'LLM test',
        rootContent: 'Test root'
      });

      const children = await configService.generateChildrenAndEvaluate({
        treeId: tree.id,
        parentId: tree.rootId,
        numChildren: 2
      }, undefined, true);

      assert.strictEqual(children.length, 2);
      
      const child1 = configService.getThought(tree.id, children[0].thoughtId);
      const child2 = configService.getThought(tree.id, children[1].thoughtId);
      
      assert.ok(child1);
      assert.ok(child2);
      assert.strictEqual(child1.evaluation, 87);
      assert.strictEqual(child1.state, 'evaluated');
      assert.strictEqual(child1.creativity, 75);
      assert.strictEqual(child1.risk, 25);
      assert.strictEqual(child1.metadata?.evaluationReasoning, 'This path looks promising because it addresses the core problem directly.');
      assert.strictEqual(child2.evaluation, 87);
      assert.strictEqual(child2.state, 'evaluated');
      assert.strictEqual(child2.creativity, 75);
      assert.strictEqual(child2.risk, 25);
      assert.strictEqual(child2.metadata?.evaluationReasoning, 'This path looks promising because it addresses the core problem directly.');
    });

    it('should throw error when generateChildrenAndEvaluate called without LLM provider', async () => {
      const tree = service.createTree({
        goal: 'LLM test',
        rootContent: 'Test root'
      });

      await assert.rejects(
        async () => {
          await service.generateChildrenAndEvaluate({
            treeId: tree.id,
            parentId: tree.rootId,
            numChildren: 2
          }, 50);
        },
        /LLM provider not configured/
      );
    });

    it('should track token usage', async () => {
      const mockLLMProvider: LLMProvider = {
        generateThoughts: async (prompt: string, count: number, context?: string) => {
          return Array.from({ length: count }, (_, i) => `AI Thought ${i + 1}`);
        },
        getLastUsageStats: () => ({
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        })
      };

      const config: ToTServiceConfig = {
        llmProvider: mockLLMProvider
      };
      const configService = new ToTService(TEST_STORAGE_PATH, config);

      const tree = configService.createTree({
        goal: 'LLM test',
        rootContent: 'Test root'
      });

      await configService.generateChildren({
        treeId: tree.id,
        parentId: tree.rootId,
        numChildren: 2
      });

      const updatedTree = configService.getTree(tree.id);
      assert.ok(updatedTree);
      assert.ok(updatedTree.usageStats);
      assert.strictEqual(updatedTree.usageStats.promptTokens, 100);
      assert.strictEqual(updatedTree.usageStats.completionTokens, 50);
      assert.strictEqual(updatedTree.usageStats.totalTokens, 150);
      assert.strictEqual(updatedTree.usageStats.requestCount, 1);
    });
  });

  describe('strategy exploration', () => {
    it('should explore with best_first strategy using evaluations', () => {
      const tree = service.createTree({
        goal: 'Strategy test',
        rootContent: 'Root',
        maxDepth: 3
      });

      // Create a tree with evaluated thoughts
      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const child3 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 3'
      });

      assert.ok(child1);
      assert.ok(child2);
      assert.ok(child3);

      // Evaluate thoughts with different scores
      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id,
        score: 30
      });

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child2.id,
        score: 90
      });

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child3.id,
        score: 60
      });

      // Add grandchildren to the highest-evaluated thought
      const grandchild1 = service.addChildThought({
        treeId: tree.id,
        parentId: child2.id!,
        content: 'Grandchild 1'
      });

      assert.ok(grandchild1);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: grandchild1.id,
        score: 95
      });

      // Explore with best_first
      const result = service.exploreWithStrategy({
        treeId: tree.id,
        strategy: 'best_first',
        maxThoughts: 10
      });

      assert.strictEqual(result.thoughtsExplored, 5);
      assert.strictEqual(result.bestEvaluation, 95);
      assert.strictEqual(result.bestThoughtId, grandchild1.id);
      assert.strictEqual(result.maxDepthReached, 2);
    });

    it('should explore with bfs strategy', () => {
      const tree = service.createTree({
        goal: 'BFS test',
        rootContent: 'Root',
        maxDepth: 3
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.exploreWithStrategy({
        treeId: tree.id,
        strategy: 'bfs',
        maxThoughts: 10
      });

      assert.strictEqual(result.thoughtsExplored, 3);
      assert.strictEqual(result.maxDepthReached, 1);
    });

    it('should explore with dfs strategy', () => {
      const tree = service.createTree({
        goal: 'DFS test',
        rootContent: 'Root',
        maxDepth: 3
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      assert.ok(child1);

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1.id!,
        content: 'Grandchild'
      });

      assert.ok(child1);
      assert.ok(grandchild);

      const result = service.exploreWithStrategy({
        treeId: tree.id,
        strategy: 'dfs',
        maxThoughts: 10
      });

      assert.strictEqual(result.thoughtsExplored, 3);
      assert.strictEqual(result.maxDepthReached, 2);
    });

    it('should respect stop criteria', () => {
      const tree = service.createTree({
        goal: 'Stop criteria test',
        rootContent: 'Root',
        maxDepth: 5
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      assert.ok(child1);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id!,
        score: 95
      });

      const result = service.exploreWithStrategy({
        treeId: tree.id,
        strategy: 'bfs',
        maxThoughts: 100,
        stopCriteria: {
          minEvaluation: 90
        }
      });

      assert.strictEqual(result.stoppedReason, 'Reached minEvaluation threshold');
    });
  });

  describe('visualization', () => {
    it('should render tree in ASCII format', async () => {
      const tree = service.createTree({
        goal: 'Visualization test',
        rootContent: 'Root thought',
        maxDepth: 3
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      assert.ok(child1);
      assert.ok(child2);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1.id!,
        score: 50
      });

      const ascii = await service.visualizeTree({
        treeId: tree.id,
        format: 'ascii'
      });

      assert.ok(ascii.includes('Visualization test'));
      assert.ok(ascii.includes('Root thought'));
      assert.ok(ascii.includes('Child 1'));
      assert.ok(ascii.includes('Child 2'));
      assert.ok(ascii.includes('[50]'));
      assert.ok(ascii.includes('└──'));
    });

    it('should render tree in Mermaid format', async () => {
      const tree = service.createTree({
        goal: 'Mermaid test',
        rootContent: 'Root',
        maxDepth: 2
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child'
      });

      const mermaid = await service.visualizeTree({
        treeId: tree.id,
        format: 'mermaid'
      });

      assert.ok(mermaid.includes('flowchart TD'));
      assert.ok(mermaid.includes('Mermaid test'));
      assert.ok(mermaid.includes('-->'));
    });

    it('should render tree in DOT format', async () => {
      const tree = service.createTree({
        goal: 'DOT test',
        rootContent: 'Root',
        maxDepth: 2
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child'
      });

      const dot = await service.visualizeTree({
        treeId: tree.id,
        format: 'dot'
      });

      assert.ok(dot.includes('digraph TreeOfThoughts'));
      assert.ok(dot.includes('DOT test'));
      assert.ok(dot.includes('->'));
    });

    it('should show thought states in visualization', async () => {
      const tree = service.createTree({
        goal: 'State test',
        rootContent: 'Root',
        maxDepth: 2
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child'
      });

      assert.ok(child);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child.id!,
        score: 75
      });

      service.verifyThought({
        treeId: tree.id,
        thoughtId: child.id!,
        verificationNotes: 'Verified'
      });

      const ascii = await service.visualizeTree({
        treeId: tree.id,
        format: 'ascii'
      });

      assert.ok(ascii.includes('✓'));
    });

    it('should throw error for non-existent tree', async () => {
      await assert.rejects(
        async () => {
          await service.visualizeTree({
            treeId: 'non-existent',
            format: 'ascii'
          });
        },
        /Tree not found/
      );
    });
  });

  describe('temperature control', () => {
    it('should calculate temperature based on depth', () => {
      const configService = new ToTService(TEST_STORAGE_PATH, {
        temperatureConfig: {
          minTemperature: 0.1,
          maxTemperature: 1.0,
          initialTemperature: 0.8,
          decayRate: 0.1
        }
      });

      const tree = configService.createTree({
        goal: 'Temperature test',
        rootContent: 'Root',
        maxDepth: 5
      });

      // Access private method via prototype for testing
      const calculateTemp = (configService as any).calculateTemperature.bind(configService);

      // Early depth should have higher temperature
      const tempAtDepth0 = calculateTemp(0, 5);
      const tempAtDepth2 = calculateTemp(2, 5);
      const tempAtDepth4 = calculateTemp(4, 5);

      assert.ok(tempAtDepth0 > tempAtDepth2, 'Temperature should decrease with depth');
      assert.ok(tempAtDepth2 > tempAtDepth4, 'Temperature should continue decreasing');
      assert.ok(tempAtDepth0 <= 1.0, 'Temperature should not exceed max');
      assert.ok(tempAtDepth4 >= 0.1, 'Temperature should not go below min');
    });

    it('should use default temperature config when not provided', () => {
      const defaultService = new ToTService(TEST_STORAGE_PATH);
      const calculateTemp = (defaultService as any).calculateTemperature.bind(defaultService);

      const temp = calculateTemp(0, 5);
      assert.ok(temp >= 0.1 && temp <= 1.0, 'Temperature should be in valid range with defaults');
    });

    it('should pass temperature to LLM provider', async () => {
      let receivedTemperature: number | undefined;
      const mockLLMProvider: LLMProvider = {
        generateThoughts: async (prompt, count, context, temperature) => {
          receivedTemperature = temperature;
          return ['Thought 1', 'Thought 2'];
        }
      };

      const configService = new ToTService(TEST_STORAGE_PATH, {
        llmProvider: mockLLMProvider,
        temperatureConfig: {
          initialTemperature: 0.9,
          decayRate: 0.05
        }
      });

      const tree = configService.createTree({
        goal: 'Temperature pass test',
        rootContent: 'Root',
        maxDepth: 3
      });

      await configService.generateChildren({
        treeId: tree.id,
        parentId: tree.rootId,
        numChildren: 2
      });

      assert.ok(receivedTemperature !== undefined, 'Temperature should be passed to LLM provider');
      assert.ok(receivedTemperature! > 0, 'Temperature should be positive');
    });

    it('should handle zero maxDepth gracefully', () => {
      const configService = new ToTService(TEST_STORAGE_PATH, {
        temperatureConfig: {
          initialTemperature: 0.8
        }
      });

      const calculateTemp = (configService as any).calculateTemperature.bind(configService);
      const temp = calculateTemp(0, 0);

      assert.ok(temp >= 0.1 && temp <= 1.0, 'Should handle zero maxDepth without error');
    });
  });

  describe('Strategy CRUD', () => {
    it('should create a strategy', () => {
      const strategy = service.createStrategy('Test Strategy', 'Test description');

      assert.ok(strategy.id);
      assert.strictEqual(strategy.name, 'Test Strategy');
      assert.strictEqual(strategy.description, 'Test description');
      assert.strictEqual(strategy.status, 'active');
      assert.deepStrictEqual(strategy.treeIds, []);
      assert.ok(strategy.createdAt);
      assert.ok(strategy.updatedAt);
    });

    it('should throw error for empty strategy name', () => {
      assert.throws(() => {
        service.createStrategy('');
      }, /Strategy name is required/);
    });

    it('should throw error for duplicate strategy name', () => {
      service.createStrategy('Duplicate Strategy');

      assert.throws(() => {
        service.createStrategy('Duplicate Strategy');
      }, /Strategy with name "Duplicate Strategy" already exists/);
    });

    it('should get strategy by ID', () => {
      const strategy = service.createStrategy('Get By ID');

      const found = service.getStrategy(strategy.id);
      assert.ok(found);
      assert.strictEqual(found.id, strategy.id);
      assert.strictEqual(found.name, 'Get By ID');
    });

    it('should get strategy by name (case-insensitive)', () => {
      service.createStrategy('Case Insensitive');

      const found = service.getStrategy('case insensitive');
      assert.ok(found);
      assert.strictEqual(found.name, 'Case Insensitive');

      const found2 = service.getStrategy('CASE INSENSITIVE');
      assert.ok(found2);
      assert.strictEqual(found2.name, 'Case Insensitive');
    });

    it('should return undefined for non-existent strategy', () => {
      const found = service.getStrategy('non-existent');
      assert.strictEqual(found, undefined);
    });

    it('should list all strategies', () => {
      service.createStrategy('Strategy 1');
      service.createStrategy('Strategy 2');
      service.createStrategy('Strategy 3');

      const strategies = service.listStrategies();
      assert.strictEqual(strategies.length, 3);
    });

    it('should list strategies filtered by status', () => {
      const s1 = service.createStrategy('Active Strategy');
      const s2 = service.createStrategy('Paused Strategy');
      const s3 = service.createStrategy('Completed Strategy');

      service.updateStrategy(s2.id, { status: 'paused' });
      service.updateStrategy(s3.id, { status: 'completed' });

      const activeStrategies = service.listStrategies('active');
      assert.strictEqual(activeStrategies.length, 1);
      assert.strictEqual(activeStrategies[0].name, 'Active Strategy');

      const pausedStrategies = service.listStrategies('paused');
      assert.strictEqual(pausedStrategies.length, 1);
      assert.strictEqual(pausedStrategies[0].name, 'Paused Strategy');
    });

    it('should update strategy', () => {
      const strategy = service.createStrategy('Original Name', 'Original description');

      const updated = service.updateStrategy(strategy.id, {
        name: 'Updated Name',
        description: 'Updated description',
        status: 'paused'
      });

      assert.ok(updated);
      assert.strictEqual(updated.name, 'Updated Name');
      assert.strictEqual(updated.description, 'Updated description');
      assert.strictEqual(updated.status, 'paused');
    });

    it('should throw error when updating to duplicate name', () => {
      service.createStrategy('Strategy A');
      const strategyB = service.createStrategy('Strategy B');

      assert.throws(() => {
        service.updateStrategy(strategyB.id, { name: 'Strategy A' });
      }, /Strategy with name "Strategy A" already exists/);
    });

    it('should return null when updating non-existent strategy', () => {
      const updated = service.updateStrategy('non-existent', { name: 'New Name' });
      assert.strictEqual(updated, null);
    });

    it('should delete strategy without deleting trees', () => {
      const strategy = service.createStrategy('Delete Test');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      service.moveTreeToStrategy(tree.id, strategy.id);

      const deleted = service.deleteStrategy(strategy.id, false);
      assert.strictEqual(deleted, true);

      // Tree should still exist but not be in strategy
      const remainingTree = service.getTree(tree.id);
      assert.ok(remainingTree);
      assert.strictEqual(remainingTree.strategyId, undefined);
    });

    it('should delete strategy and its trees', () => {
      const strategy = service.createStrategy('Delete With Trees');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      service.moveTreeToStrategy(tree.id, strategy.id);

      const deleted = service.deleteStrategy(strategy.id, true);
      assert.strictEqual(deleted, true);

      // Tree should be deleted
      const remainingTree = service.getTree(tree.id);
      assert.strictEqual(remainingTree, undefined);
    });

    it('should return false when deleting non-existent strategy', () => {
      const deleted = service.deleteStrategy('non-existent');
      assert.strictEqual(deleted, false);
    });
  });

  describe('Tree-Strategy operations', () => {
    it('should move tree to strategy', () => {
      const strategy = service.createStrategy('Move Test');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      const moved = service.moveTreeToStrategy(tree.id, strategy.id);
      assert.strictEqual(moved, true);

      const updatedTree = service.getTree(tree.id);
      assert.ok(updatedTree);
      assert.strictEqual(updatedTree.strategyId, strategy.id);

      const updatedStrategy = service.getStrategy(strategy.id);
      assert.ok(updatedStrategy);
      assert.ok(updatedStrategy.treeIds.includes(tree.id));
    });

    it('should move tree between strategies', () => {
      const strategy1 = service.createStrategy('Strategy 1');
      const strategy2 = service.createStrategy('Strategy 2');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      service.moveTreeToStrategy(tree.id, strategy1.id);
      service.moveTreeToStrategy(tree.id, strategy2.id);

      const updatedTree = service.getTree(tree.id);
      assert.ok(updatedTree);
      assert.strictEqual(updatedTree.strategyId, strategy2.id);

      const s1 = service.getStrategy(strategy1.id);
      const s2 = service.getStrategy(strategy2.id);
      assert.ok(s1);
      assert.ok(s2);
      assert.ok(!s1.treeIds.includes(tree.id));
      assert.ok(s2.treeIds.includes(tree.id));
    });

    it('should throw error when moving non-existent tree', () => {
      const strategy = service.createStrategy('Test');

      assert.throws(() => {
        service.moveTreeToStrategy('non-existent', strategy.id);
      }, /Tree not found/);
    });

    it('should throw error when moving to non-existent strategy', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      assert.throws(() => {
        service.moveTreeToStrategy(tree.id, 'non-existent');
      }, /Strategy not found/);
    });

    it('should remove tree from strategy', () => {
      const strategy = service.createStrategy('Remove Test');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      service.moveTreeToStrategy(tree.id, strategy.id);

      const removed = service.removeTreeFromStrategy(tree.id);
      assert.strictEqual(removed, true);

      const updatedTree = service.getTree(tree.id);
      assert.ok(updatedTree);
      assert.strictEqual(updatedTree.strategyId, undefined);

      const updatedStrategy = service.getStrategy(strategy.id);
      assert.ok(updatedStrategy);
      assert.ok(!updatedStrategy.treeIds.includes(tree.id));
    });

    it('should handle removing tree not in strategy', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      const removed = service.removeTreeFromStrategy(tree.id);
      assert.strictEqual(removed, true);
    });

    it('should clone tree to strategy', () => {
      const strategy = service.createStrategy('Clone Test');
      const tree = service.createTree({
        goal: 'Original goal',
        rootContent: 'Root thought'
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child thought'
      });

      assert.ok(child);

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child.id!,
        score: 75,
        creativity: 80,
        risk: 30
      });

      const result = service.cloneTreeToStrategy(tree.id, strategy.id);
      assert.ok(result.newTreeId);
      assert.notStrictEqual(result.newTreeId, tree.id);

      const clonedTree = service.getTree(result.newTreeId);
      assert.ok(clonedTree);
      assert.strictEqual(clonedTree.strategyId, strategy.id);
      assert.strictEqual(clonedTree.goal, 'Original goal');
      assert.strictEqual(clonedTree.thoughts.size, 2);

      // Verify IDs are different
      assert.notStrictEqual(clonedTree.rootId, tree.rootId);

      // Verify thought structure is preserved
      const clonedRoot = clonedTree.thoughts.get(clonedTree.rootId);
      assert.ok(clonedRoot);
      assert.strictEqual(clonedRoot.content, 'Root thought');

      // Verify evaluation scores are preserved
      const clonedThoughts = Array.from(clonedTree.thoughts.values());
      const evaluatedThought = clonedThoughts.find(t => t.content === 'Child thought');
      assert.ok(evaluatedThought);
      assert.strictEqual(evaluatedThought.evaluation, 75);
      assert.strictEqual(evaluatedThought.creativity, 80);
      assert.strictEqual(evaluatedThought.risk, 30);
    });

    it('should clone tree with name prefix', () => {
      const strategy = service.createStrategy('Prefix Test');
      const tree = service.createTree({
        goal: 'Original goal',
        rootContent: 'Root'
      });

      const result = service.cloneTreeToStrategy(tree.id, strategy.id, { namePrefix: 'Copy of' });
      const clonedTree = service.getTree(result.newTreeId);

      assert.ok(clonedTree);
      assert.strictEqual(clonedTree.goal, 'Copy of Original goal');
    });

    it('should throw error when cloning non-existent tree', () => {
      const strategy = service.createStrategy('Test');

      assert.throws(() => {
        service.cloneTreeToStrategy('non-existent', strategy.id);
      }, /Tree not found/);
    });

    it('should throw error when cloning to non-existent strategy', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      assert.throws(() => {
        service.cloneTreeToStrategy(tree.id, 'non-existent');
      }, /Strategy not found/);
    });
  });

  describe('Strategy query helpers', () => {
    it('should get trees by strategy', () => {
      const strategy = service.createStrategy('Query Test');
      const tree1 = service.createTree({
        goal: 'Goal 1',
        rootContent: 'Root 1'
      });
      const tree2 = service.createTree({
        goal: 'Goal 2',
        rootContent: 'Root 2'
      });

      service.moveTreeToStrategy(tree1.id, strategy.id);
      service.moveTreeToStrategy(tree2.id, strategy.id);

      const trees = service.getTreesByStrategy(strategy.id);
      assert.strictEqual(trees.length, 2);
      assert.ok(trees.find(t => t.id === tree1.id));
      assert.ok(trees.find(t => t.id === tree2.id));
    });

    it('should get trees by strategy name', () => {
      const strategy = service.createStrategy('Name Query');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      service.moveTreeToStrategy(tree.id, strategy.id);

      const trees = service.getTreesByStrategy('name query');
      assert.strictEqual(trees.length, 1);
      assert.strictEqual(trees[0].id, tree.id);
    });

    it('should return empty array for non-existent strategy', () => {
      const trees = service.getTreesByStrategy('non-existent');
      assert.deepStrictEqual(trees, []);
    });

    it('should get strategy with trees and stats', () => {
      const strategy = service.createStrategy('Stats Test');
      const tree1 = service.createTree({
        goal: 'Goal 1',
        rootContent: 'Root 1'
      });
      const tree2 = service.createTree({
        goal: 'Goal 2',
        rootContent: 'Root 2'
      });

      service.moveTreeToStrategy(tree1.id, strategy.id);
      service.moveTreeToStrategy(tree2.id, strategy.id);

      const child1 = service.addChildThought({
        treeId: tree1.id,
        parentId: tree1.rootId,
        content: 'Child 1'
      });

      assert.ok(child1);

      service.evaluateThought({
        treeId: tree1.id,
        thoughtId: child1.id!,
        score: 75
      });

      const child2 = service.addChildThought({
        treeId: tree2.id,
        parentId: tree2.rootId,
        content: 'Child 2'
      });

      assert.ok(child2);

      service.evaluateThought({
        treeId: tree2.id,
        thoughtId: child2.id!,
        score: 85
      });

      const context = service.getStrategyWithTrees(strategy.id);
      assert.ok(context);
      assert.strictEqual(context.strategy.id, strategy.id);
      assert.strictEqual(context.trees.length, 2);
      assert.strictEqual(context.stats.totalTrees, 2);
      assert.strictEqual(context.stats.totalThoughts, 4); // 2 roots + 2 children
      assert.strictEqual(context.stats.averageEvaluation, 80); // (75 + 85) / 2
    });

    it('should return null for non-existent strategy context', () => {
      const context = service.getStrategyWithTrees('non-existent');
      assert.strictEqual(context, null);
    });
  });

  describe('Strategy persistence', () => {
    it('should save and load strategies', async () => {
      const strategy = service.createStrategy('Persistence Strategy', 'Test description');
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Test root'
      });

      service.moveTreeToStrategy(tree.id, strategy.id);

      await service.save();

      const newService = new ToTService(TEST_STORAGE_PATH);
      await newService.load();

      const loadedStrategy = newService.getStrategy(strategy.id);
      assert.ok(loadedStrategy);
      assert.strictEqual(loadedStrategy.name, 'Persistence Strategy');
      assert.strictEqual(loadedStrategy.description, 'Test description');
      assert.ok(loadedStrategy.treeIds.includes(tree.id));

      const loadedTree = newService.getTree(tree.id);
      assert.ok(loadedTree);
      assert.strictEqual(loadedTree.strategyId, strategy.id);
    });

    it('should handle backward compatibility (no strategies in storage)', async () => {
      // Create storage file without strategies
      const storageData = {
        trees: {}
      };
      await fs.writeFile(TEST_STORAGE_PATH, JSON.stringify(storageData, null, 2));

      const newService = new ToTService(TEST_STORAGE_PATH);
      await newService.load();

      // Should load successfully with empty strategies
      const strategies = newService.listStrategies();
      assert.deepStrictEqual(strategies, []);
    });
  });

  describe('moveSubtree', () => {
    it('should move a subtree to a new parent', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought',
        maxDepth: 10
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.movedCount, 2); // child1 + grandchild
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.newSubtreeRootDepth, 2); // child2 is at depth 1

      const movedChild = tree.thoughts.get(child1!.id);
      assert.strictEqual(movedChild!.parentId, child2!.id);
      assert.strictEqual(movedChild!.depth, 2);
      assert.ok(movedChild!.movedAt);
      assert.ok(movedChild!.updatedAt);

      const movedGrandchild = tree.thoughts.get(grandchild!.id);
      assert.strictEqual(movedGrandchild!.depth, 3);
      assert.ok(movedGrandchild!.movedAt);
    });

    it('should prevent moving tree root', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: tree.rootId,
        newParentId: child!.id
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Cannot move the tree root')));
      assert.strictEqual(result.movedCount, 0);
    });

    it('should detect and prevent cycles', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild'
      });

      // Try to move child1 under its descendant (grandchild)
      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: grandchild!.id
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('would create a cycle')));
      assert.strictEqual(result.movedCount, 0);
    });

    it('should enforce depth limits', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought',
        maxDepth: 3
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild'
      });

      const greatGrandchild = service.addChildThought({
        treeId: tree.id,
        parentId: grandchild!.id,
        content: 'Great grandchild'
      });

      // Try to move child1 (depth 1 with great-grandchild at depth 3) under child2 (depth 1)
      // This would make great-grandchild depth 4, which exceeds maxDepth of 3
      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('exceed max depth')));
    });

    it('should support dry-run mode', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const originalParentId = child1!.parentId;
      const originalDepth = child1!.depth;

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id,
        dryRun: true
      });

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('dry run')));
      assert.strictEqual(result.movedCount, 1);

      // Verify no changes were made
      const unchangedChild = tree.thoughts.get(child1!.id);
      assert.strictEqual(unchangedChild!.parentId, originalParentId);
      assert.strictEqual(unchangedChild!.depth, originalDepth);
      assert.strictEqual(unchangedChild!.movedAt, undefined);
    });

    it('should update timestamps on moved subtree and tree', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild'
      });

      const originalTreeUpdatedAt = tree.updatedAt;

      // Wait a bit to ensure timestamp difference
      const start = Date.now();
      while (Date.now() - start < 10) {}

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);

      const movedChild = tree.thoughts.get(child1!.id);
      const movedGrandchild = tree.thoughts.get(grandchild!.id);

      assert.ok(movedChild!.updatedAt > originalTreeUpdatedAt);
      assert.ok(movedGrandchild!.updatedAt > originalTreeUpdatedAt);
      assert.ok(tree.updatedAt > originalTreeUpdatedAt);
      assert.ok(movedChild!.movedAt);
      assert.ok(movedGrandchild!.movedAt);
    });

    it('should handle moving to same parent (no-op)', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: tree.rootId
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.movedCount, 0);
      assert.ok(result.warnings.some(w => w.includes('already under the specified parent')));
    });

    it('should throw error for non-existent tree', () => {
      assert.throws(() => {
        service.moveSubtree({
          treeId: 'non-existent',
          subtreeRootId: 'some-id',
          newParentId: 'another-id'
        });
      }, /Tree not found/);
    });

    it('should throw error for non-existent subtree root', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      assert.throws(() => {
        service.moveSubtree({
          treeId: tree.id,
          subtreeRootId: 'non-existent',
          newParentId: tree.rootId
        });
      }, /Thought not found/);
    });

    it('should throw error for non-existent new parent', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child'
      });

      assert.throws(() => {
        service.moveSubtree({
          treeId: tree.id,
          subtreeRootId: child!.id,
          newParentId: 'non-existent'
        });
      }, /Thought not found/);
    });

    it('should correctly update old parent children list', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);

      const root = tree.thoughts.get(tree.rootId);
      assert.ok(root!.children.every(id => id !== child1!.id));
      assert.strictEqual(root!.children.length, 1);
      assert.strictEqual(root!.children[0], child2!.id);
    });

    it('should correctly update new parent children list', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);

      const newParent = tree.thoughts.get(child2!.id);
      assert.ok(newParent!.children.includes(child1!.id));
    });

    it('should populate affectedThoughtIds correctly', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const grandchild1 = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild 1'
      });

      const grandchild2 = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild 2'
      });

      const greatGrandchild = service.addChildThought({
        treeId: tree.id,
        parentId: grandchild1!.id,
        content: 'Great grandchild'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.affectedThoughtIds.length, 4);
      assert.ok(result.affectedThoughtIds.includes(child1!.id));
      assert.ok(result.affectedThoughtIds.includes(grandchild1!.id));
      assert.ok(result.affectedThoughtIds.includes(grandchild2!.id));
      assert.ok(result.affectedThoughtIds.includes(greatGrandchild!.id));
    });

    it('should preserve thought states during move', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild'
      });

      service.evaluateThought({
        treeId: tree.id,
        thoughtId: child1!.id,
        score: 75,
        creativity: 80,
        risk: 30
      });

      service.verifyThought({
        treeId: tree.id,
        thoughtId: grandchild!.id,
        verificationNotes: 'Verified'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);

      const movedChild = tree.thoughts.get(child1!.id);
      const movedGrandchild = tree.thoughts.get(grandchild!.id);

      assert.strictEqual(movedChild!.evaluation, 75);
      assert.strictEqual(movedChild!.creativity, 80);
      assert.strictEqual(movedChild!.risk, 30);
      assert.strictEqual(movedChild!.state, 'evaluated');
      assert.strictEqual(movedGrandchild!.verified, true);
      assert.strictEqual(movedGrandchild!.verificationNotes, 'Verified');
      // verifyThought sets verified flag but doesn't change state
      assert.strictEqual(movedGrandchild!.state, 'pending');
    });

    it('should preserve thought metadata during move', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1',
        metadata: { customField: 'customValue', sessionId: 'session123' }
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);

      const movedChild = tree.thoughts.get(child1!.id);
      assert.deepStrictEqual(movedChild!.metadata, { customField: 'customValue', sessionId: 'session123' });
    });

    it('should handle moving subtree with multiple levels of grandchildren', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought',
        maxDepth: 10
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const grandchild1 = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild 1'
      });

      const greatGrandchild1 = service.addChildThought({
        treeId: tree.id,
        parentId: grandchild1!.id,
        content: 'Great grandchild 1'
      });

      const greatGreatGrandchild = service.addChildThought({
        treeId: tree.id,
        parentId: greatGrandchild1!.id,
        content: 'Great great grandchild'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.movedCount, 4);
      assert.strictEqual(result.newSubtreeRootDepth, 2);

      const movedChild = tree.thoughts.get(child1!.id);
      const movedGrandchild = tree.thoughts.get(grandchild1!.id);
      const movedGreatGrandchild = tree.thoughts.get(greatGrandchild1!.id);
      const movedGreatGreatGrandchild = tree.thoughts.get(greatGreatGrandchild!.id);

      assert.strictEqual(movedChild!.depth, 2);
      assert.strictEqual(movedGrandchild!.depth, 3);
      assert.strictEqual(movedGreatGrandchild!.depth, 4);
      assert.strictEqual(movedGreatGreatGrandchild!.depth, 5);
    });

    it('should handle moving subtree with multiple children at same level', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought'
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const grandchild1 = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild 1'
      });

      const grandchild2 = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild 2'
      });

      const grandchild3 = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild 3'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.movedCount, 4);

      const movedChild = tree.thoughts.get(child1!.id);
      assert.strictEqual(movedChild!.children.length, 3);
      assert.ok(movedChild!.children.includes(grandchild1!.id));
      assert.ok(movedChild!.children.includes(grandchild2!.id));
      assert.ok(movedChild!.children.includes(grandchild3!.id));
    });

    it('should calculate newSubtreeRootDepth correctly', () => {
      const tree = service.createTree({
        goal: 'Test goal',
        rootContent: 'Root thought',
        maxDepth: 10
      });

      const child1 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 1'
      });

      const grandchild = service.addChildThought({
        treeId: tree.id,
        parentId: child1!.id,
        content: 'Grandchild'
      });

      const child2 = service.addChildThought({
        treeId: tree.id,
        parentId: tree.rootId,
        content: 'Child 2'
      });

      const result = service.moveSubtree({
        treeId: tree.id,
        subtreeRootId: child1!.id,
        newParentId: child2!.id
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.newSubtreeRootDepth, 2);

      const movedChild = tree.thoughts.get(child1!.id);
      assert.strictEqual(movedChild!.depth, 2);
    });
  });

  describe('clear operations', () => {
    it('should clear a specific tree', () => {
      const tree1 = service.createTree({
        goal: 'Tree 1',
        rootContent: 'Root 1'
      });

      const tree2 = service.createTree({
        goal: 'Tree 2',
        rootContent: 'Root 2'
      });

      assert.strictEqual(service.getAllTrees().length, 2);

      const cleared = service.clearTree(tree1.id);
      assert.strictEqual(cleared, true);
      assert.strictEqual(service.getAllTrees().length, 1);
      assert.strictEqual(service.getTree(tree1.id), undefined);
      assert.ok(service.getTree(tree2.id));
    });

    it('should return false when clearing non-existent tree', () => {
      const cleared = service.clearTree('non-existent-id');
      assert.strictEqual(cleared, false);
    });

    it('should clear a specific strategy', () => {
      const strategy1 = service.createStrategy('Strategy 1', 'Description 1');
      const strategy2 = service.createStrategy('Strategy 2', 'Description 2');

      assert.strictEqual(service.listStrategies().length, 2);

      const cleared = service.clearStrategy(strategy1.id);
      assert.strictEqual(cleared, true);
      assert.strictEqual(service.listStrategies().length, 1);
      assert.strictEqual(service.getStrategy(strategy1.id), undefined);
      assert.ok(service.getStrategy(strategy2.id));
    });

    it('should return false when clearing non-existent strategy', () => {
      const cleared = service.clearStrategy('non-existent-id');
      assert.strictEqual(cleared, false);
    });

    it('should clear everything (trees and strategies)', () => {
      const tree1 = service.createTree({
        goal: 'Tree 1',
        rootContent: 'Root 1'
      });

      const tree2 = service.createTree({
        goal: 'Tree 2',
        rootContent: 'Root 2'
      });

      const strategy1 = service.createStrategy('Strategy 1', 'Description 1');
      const strategy2 = service.createStrategy('Strategy 2', 'Description 2');

      assert.strictEqual(service.getAllTrees().length, 2);
      assert.strictEqual(service.listStrategies().length, 2);

      service.clearEverything();

      assert.strictEqual(service.getAllTrees().length, 0);
      assert.strictEqual(service.listStrategies().length, 0);
    });
  });
});
