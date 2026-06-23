import { describe, it, before, after } from 'node:test';
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
      }, /Invalid evaluation score/);
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
    it('should render tree in ASCII format', () => {
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

      const ascii = service.visualizeTree({
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

    it('should render tree in Mermaid format', () => {
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

      const mermaid = service.visualizeTree({
        treeId: tree.id,
        format: 'mermaid'
      });

      assert.ok(mermaid.includes('flowchart TD'));
      assert.ok(mermaid.includes('Mermaid test'));
      assert.ok(mermaid.includes('-->'));
    });

    it('should render tree in DOT format', () => {
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

      const dot = service.visualizeTree({
        treeId: tree.id,
        format: 'dot'
      });

      assert.ok(dot.includes('digraph TreeOfThoughts'));
      assert.ok(dot.includes('DOT test'));
      assert.ok(dot.includes('->'));
    });

    it('should show thought states in visualization', () => {
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

      const ascii = service.visualizeTree({
        treeId: tree.id,
        format: 'ascii'
      });

      assert.ok(ascii.includes('✓'));
    });

    it('should throw error for non-existent tree', () => {
      assert.throws(() => {
        service.visualizeTree({
          treeId: 'non-existent',
          format: 'ascii'
        });
      }, /Tree not found/);
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
});
