import { Thought, Tree, CreateTreeParams, AddChildParams, EvaluateParams, SelectParams, VerifyParams, BacktrackParams, PruneParams, TreeStats, BranchingStrategyType, ExploreWithStrategyParams, ExplorationResult, ProposeAndEvaluateParams, GenerateChildrenParams, GeneratedChild, ToTServiceConfig, TreeNotFoundError, ThoughtNotFoundError, MaxDepthReachedError, InvalidEvaluationError, InvalidStrategyError, UnverifiedThoughtError, LLMProvider, StopCriteria, StrategyCallback, TraversalStrategyConfig, VisualizationFormat, VisualizeTreeParams, UsageStats, NextActionSuggestion } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const logger = {
  info: (message: string) => console.log(`[ToTService] ${message}`),
  error: (message: string) => console.error(`[ToTService] ${message}`),
  warn: (message: string) => console.error(`[ToTService] ${message}`)
};

export { ToTServiceConfig, LLMProvider } from './types.js';

export class ToTService {
  private trees: Map<string, Tree>;
  private storagePath: string;
  private config: ToTServiceConfig;
  private readonly MAX_CONTENT_LENGTH = 50;

  constructor(storagePath: string, config?: ToTServiceConfig) {
    this.trees = new Map();
    this.storagePath = storagePath;
    this.config = config || {};
  }

  /**
   * Format a thought label with consistent truncation and optional verification marker
   */
  private formatThoughtLabel(thought: Thought, includeVerification: boolean = false): string {
    const evalText = thought.evaluation !== null ? ` [${thought.evaluation}]` : '';
    const content = thought.content.length > this.MAX_CONTENT_LENGTH 
      ? thought.content.substring(0, this.MAX_CONTENT_LENGTH - 3) + '...' 
      : thought.content;
    const verificationMarker = includeVerification && thought.verified ? ' ✓ verified' : '';
    return `${content}${evalText}${verificationMarker}`;
  }

  /**
   * Calculate dynamic temperature based on tree depth and exploration stage
   * Higher temperature early for creativity, lower when converging
   */
  private calculateTemperature(currentDepth: number, maxDepth: number): number {
    const config = this.config.temperatureConfig || {};
    const minTemp = config.minTemperature ?? 0.1;
    const maxTemp = config.maxTemperature ?? 1.0;
    const initialTemp = config.initialTemperature ?? 0.8;
    const decayRate = config.decayRate ?? 0.1;

    // Calculate progress (0 to 1)
    const progress = maxDepth > 0 ? currentDepth / maxDepth : 0;

    // Linear decay from initial to minimum temperature
    const temperature = Math.max(minTemp, initialTemp - (progress * (initialTemp - minTemp) * decayRate * 10));

    // Clamp to valid range
    return Math.min(maxTemp, Math.max(minTemp, temperature));
  }

  /**
   * Track LLM usage statistics for a tree
   */
  private trackUsage(treeId: string): void {
    const tree = this.trees.get(treeId);
    if (!tree || !this.config.llmProvider?.getLastUsageStats) {
      return;
    }

    const stats = this.config.llmProvider.getLastUsageStats();
    if (!stats) {
      return;
    }

    if (!tree.usageStats) {
      tree.usageStats = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0
      };
    }

    tree.usageStats.promptTokens += stats.promptTokens;
    tree.usageStats.completionTokens += stats.completionTokens;
    tree.usageStats.totalTokens += stats.totalTokens;
    tree.usageStats.requestCount += 1;
    tree.updatedAt = new Date().toISOString();
  }

  /**
   * Build rich context for thought generation
   * Includes tree goal, parent thought, ancestor path, siblings, best thoughts, and statistics
   */
  private buildRichContextForGeneration(tree: Tree, parentThought: Thought, numChildren?: number): string {
    const lines: string[] = [];

    // Tree goal and configuration
    lines.push(`=== TREE OF THOUGHTS GENERATION CONTEXT ===`);
    lines.push(`Goal: ${tree.goal}`);
    lines.push(`Max Depth: ${tree.maxDepth}`);
    lines.push(`Number of children to generate: ${numChildren || 3}`);
    lines.push('');

    // Parent thought information
    lines.push(`=== PARENT THOUGHT ===`);
    lines.push(`Content: ${parentThought.content}`);
    lines.push(`Depth: ${parentThought.depth}`);
    lines.push(`State: ${parentThought.state}`);
    if (parentThought.evaluation !== null) {
      lines.push(`Evaluation: ${parentThought.evaluation}/100`);
    }
    if (parentThought.creativity !== undefined && parentThought.creativity !== null) {
      lines.push(`Creativity: ${parentThought.creativity}/100`);
    }
    if (parentThought.risk !== undefined && parentThought.risk !== null) {
      lines.push(`Risk: ${parentThought.risk}/100`);
    }
    lines.push('');

    // Ancestor path (root → parent)
    lines.push(`=== ANCESTOR PATH (from root to parent) ===`);
    const ancestorPath: Thought[] = [];
    let currentThought: Thought | null = parentThought;
    while (currentThought) {
      ancestorPath.unshift(currentThought);
      if (currentThought.parentId) {
        currentThought = tree.thoughts.get(currentThought.parentId) || null;
      } else {
        currentThought = null;
      }
    }
    ancestorPath.forEach((thought, index) => {
      const evalText = thought.evaluation !== null ? ` [eval: ${thought.evaluation}]` : '';
      lines.push(`${index}. ${thought.content}${evalText}`);
    });
    lines.push('');

    // Sibling thoughts at the same level
    if (parentThought.parentId) {
      const grandparent = tree.thoughts.get(parentThought.parentId);
      if (grandparent) {
        const siblings = grandparent.children
          .map(id => tree.thoughts.get(id))
          .filter(t => t && t.id !== parentThought.id) as Thought[];
        
        if (siblings.length > 0) {
          lines.push(`=== SIBLING THOUGHTS (at same level) ===`);
          siblings.forEach((sibling, index) => {
            const evalText = sibling.evaluation !== null ? ` [eval: ${sibling.evaluation}]` : '';
            lines.push(`${index + 1}. ${sibling.content}${evalText}`);
          });
          lines.push('');
        }
      }
    }

    // Top 3-4 best thoughts in the tree so far
    const bestThoughts = this.getBestThoughts(tree.id, 4, 'evaluation');
    if (bestThoughts.length > 0) {
      lines.push(`=== TOP EVALUATED THOUGHTS IN TREE ===`);
      bestThoughts.forEach((thought, index) => {
        const badges = [];
        if (thought.creativity !== undefined && thought.creativity !== null) {
          badges.push(`C:${thought.creativity}`);
        }
        if (thought.risk !== undefined && thought.risk !== null) {
          badges.push(`R:${thought.risk}`);
        }
        const badgeText = badges.length > 0 ? ` [${badges.join(', ')}]` : '';
        lines.push(`${index + 1}. ${thought.content} [eval: ${thought.evaluation}]${badgeText}`);
      });
      lines.push('');
    }

    // Tree statistics
    const stats = this.getTreeStats(tree.id);
    if (stats) {
      lines.push(`=== TREE STATISTICS ===`);
      lines.push(`Total thoughts: ${stats.totalThoughts}`);
      lines.push(`Evaluated thoughts: ${stats.evaluatedThoughts}`);
      lines.push(`Average evaluation: ${stats.averageEvaluation.toFixed(1)}`);
      if (stats.averageCreativity !== undefined) {
        lines.push(`Average creativity: ${stats.averageCreativity.toFixed(1)}`);
      }
      if (stats.averageRisk !== undefined) {
        lines.push(`Average risk: ${stats.averageRisk.toFixed(1)}`);
      }
      lines.push(`Max depth reached: ${stats.maxDepthReached}`);
      lines.push('');
    }

    // Task instruction
    lines.push(`=== TASK ===`);
    lines.push(`Generate ${numChildren || 3} diverse child thoughts that extend from the parent thought.`);
    lines.push(`Each child should be a distinct, promising direction for solving the goal.`);
    lines.push(`Consider the ancestor path, siblings, and best thoughts to avoid redundancy.`);
    lines.push(`Aim for creativity while maintaining feasibility and goal alignment.`);

    return lines.join('\n');
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid storage file format: not an object');
      }

      if (!parsed.trees || typeof parsed.trees !== 'object') {
        throw new Error('Invalid storage file format: missing or invalid trees object');
      }

      this.trees = new Map();
      for (const [id, treeData] of Object.entries(parsed.trees || {})) {
        if (!treeData || typeof treeData !== 'object') {
          logger.warn(`Skipping invalid tree data for ID: ${id}`);
          continue;
        }

        const tree = treeData as Tree;
        
        if (!tree.id || !tree.rootId || !tree.goal || !tree.thoughts) {
          logger.warn(`Skipping malformed tree for ID: ${id}`);
          continue;
        }

        tree.thoughts = new Map(Object.entries((treeData as any).thoughts));
        this.trees.set(id, tree);
      }

      logger.info(`Loaded ${this.trees.size} trees from storage`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet — first run or was deleted. Create it with empty state.
        logger.info(`Storage file not found at ${this.storagePath}. Creating new empty storage.`);
        this.trees = new Map();
        await this.save(); // ← This creates the file
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to load ToT service state: ${message}. Starting with empty state.`);
      this.trees = new Map();
    }
  }

  async save(): Promise<void> {
    const tempPath = `${this.storagePath}.tmp`;
    
    try {
      const serialized: Record<string, any> = {
        trees: {}
      };
      
      for (const [id, tree] of this.trees.entries()) {
        serialized.trees[id] = {
          ...tree,
          thoughts: Object.fromEntries(tree.thoughts)
        };
      }
      
      const jsonData = JSON.stringify(serialized, null, 2);
      
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      
      await fs.writeFile(tempPath, jsonData, 'utf-8');
      
      await fs.rename(tempPath, this.storagePath);
      
      logger.info(`Saved ${this.trees.size} trees to storage`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to save ToT service state: ${message}`);
      
      try {
        await fs.unlink(tempPath).catch(() => {});
      } catch (cleanupErr) {
        logger.error(`Failed to cleanup temp file: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
      }
      
      throw new Error(`Save failed: ${message}`);
    }
  }

  createTree(params: CreateTreeParams): Tree {
    const treeId = uuidv4();
    const rootId = uuidv4();
    const now = new Date().toISOString();
    
    const rootThought: Thought = {
      id: rootId,
      content: params.rootContent,
      parentId: null,
      children: [],
      evaluation: null,
      state: 'pending',
      depth: 0,
      createdAt: now,
      metadata: params.metadata
    };
    
    const thoughts = new Map<string, Thought>();
    thoughts.set(rootId, rootThought);
    
    const tree: Tree = {
      id: treeId,
      rootId,
      thoughts,
      goal: params.goal,
      createdAt: now,
      updatedAt: now,
      maxDepth: params.maxDepth || 10,
      metadata: params.metadata
    };
    
    this.trees.set(treeId, tree);
    return tree;
  }

  getTree(treeId: string): Tree | undefined {
    return this.trees.get(treeId);
  }

  getAllTrees(): Tree[] {
    return Array.from(this.trees.values());
  }

  deleteTree(treeId: string): boolean {
    return this.trees.delete(treeId);
  }

  addChildThought(params: AddChildParams): Thought | null {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const parentThought = tree.thoughts.get(params.parentId);
    if (!parentThought) {
      throw new ThoughtNotFoundError(params.treeId, params.parentId);
    }

    if (parentThought.depth >= tree.maxDepth) {
      throw new MaxDepthReachedError(params.treeId, parentThought.depth, tree.maxDepth);
    }
    
    const childId = uuidv4();
    const now = new Date().toISOString();
    
    const childThought: Thought = {
      id: childId,
      content: params.content,
      parentId: params.parentId,
      children: [],
      evaluation: null,
      state: 'pending',
      depth: parentThought.depth + 1,
      createdAt: now,
      metadata: params.metadata
    };
    
    parentThought.children.push(childId);
    tree.thoughts.set(childId, childThought);
    tree.updatedAt = now;
    
    return childThought;
  }

  evaluateThought(params: EvaluateParams): Thought | null {
    if (params.score < 0 || params.score > 100) {
      throw new InvalidEvaluationError(params.score);
    }

    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const thought = tree.thoughts.get(params.thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(params.treeId, params.thoughtId);
    }

    thought.evaluation = params.score;
    thought.state = 'evaluated';
    
    // Store multi-criteria evaluation fields
    if (params.creativity !== undefined) {
      thought.creativity = params.creativity;
    }
    if (params.risk !== undefined) {
      thought.risk = params.risk;
    }
    if (params.criteriaScores) {
      thought.criteriaScores = params.criteriaScores;
    }
    
    if (params.reasoning) {
      thought.metadata = thought.metadata || {};
      thought.metadata.evaluationReasoning = params.reasoning;
    }
    tree.updatedAt = new Date().toISOString();

    return thought;
  }

  verifyThought(params: VerifyParams): Thought | null {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const thought = tree.thoughts.get(params.thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(params.treeId, params.thoughtId);
    }

    thought.verified = true;
    if (params.verificationNotes) {
      thought.verificationNotes = params.verificationNotes;
    }
    tree.updatedAt = new Date().toISOString();

    return thought;
  }

  selectThought(params: SelectParams): Thought | null {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const thought = tree.thoughts.get(params.thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(params.treeId, params.thoughtId);
    }

    if (!thought.verified) {
      throw new UnverifiedThoughtError(params.thoughtId);
    }

    thought.state = 'selected';
    tree.updatedAt = new Date().toISOString();

    return thought;
  }

  backtrack(params: BacktrackParams): Thought | null {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const thought = tree.thoughts.get(params.thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(params.treeId, params.thoughtId);
    }
    
    // Mark all descendants as pruned
    const pruneDescendants = (thoughtId: string) => {
      const t = tree.thoughts.get(thoughtId);
      if (!t) return;
      
      t.state = 'pruned';
      for (const childId of t.children) {
        pruneDescendants(childId);
      }
    };
    
    for (const childId of thought.children) {
      pruneDescendants(childId);
    }
    
    tree.updatedAt = new Date().toISOString();
    
    return thought;
  }

  pruneTree(params: PruneParams): { prunedCount: number; remainingCount: number } {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }
    
    let prunedCount = 0;
    
    // Iterative approach using a stack to avoid recursion depth issues
    const stack: string[] = [tree.rootId];
    
    while (stack.length > 0) {
      const thoughtId = stack.pop()!;
      const thought = tree.thoughts.get(thoughtId);
      
      if (!thought) continue;
      
      // Skip if already pruned to avoid double-counting
      if (thought.state === 'pruned') {
        continue;
      }
      
      // Prune if evaluated and below threshold
      if (thought.state === 'evaluated' && thought.evaluation !== null && thought.evaluation < params.threshold) {
        thought.state = 'pruned';
        prunedCount++;
      }
      
      // Prune if risk threshold is set and risk exceeds threshold
      // Only apply risk-based pruning if the thought has a defined risk value
      if (params.riskThreshold !== undefined && 
          thought.risk !== null && 
          thought.risk !== undefined && 
          thought.risk > params.riskThreshold) {
        // Only prune if not already pruned by evaluation threshold
        if (thought.state !== 'pruned') {
          thought.state = 'pruned';
          prunedCount++;
        }
      }
      
      // Push children onto stack for processing
      for (const childId of thought.children) {
        stack.push(childId);
      }
    }
    
    tree.updatedAt = new Date().toISOString();
    
    const totalPrunedInTree = Array.from(tree.thoughts.values()).filter(t => t.state === 'pruned').length;
    const remainingCount = tree.thoughts.size - totalPrunedInTree;
    return { prunedCount, remainingCount };
  }

  getThought(treeId: string, thoughtId: string): Thought | null {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }
    const thought = tree.thoughts.get(thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(treeId, thoughtId);
    }
    return thought;
  }

  getTreeStructure(treeId: string): any {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }
    
    // Iterative approach using a stack to avoid recursion depth issues
    const stack: Array<{ thoughtId: string; parent: any }> = [
      { thoughtId: tree.rootId, parent: null }
    ];
    const structureMap = new Map<string, any>();
    
    while (stack.length > 0) {
      const { thoughtId, parent } = stack.pop()!;
      const thought = tree.thoughts.get(thoughtId);
      
      if (!thought) continue;
      
      const nodeStructure = {
        id: thought.id,
        content: thought.content,
        evaluation: thought.evaluation,
        state: thought.state,
        depth: thought.depth,
        creativity: thought.creativity,
        risk: thought.risk,
        criteriaScores: thought.criteriaScores,
        children: [] as any[]
      };
      
      structureMap.set(thoughtId, nodeStructure);
      
      if (parent) {
        parent.children.push(nodeStructure);
      }
      
      // Push children onto stack in reverse order to maintain original order
      for (let i = thought.children.length - 1; i >= 0; i--) {
        stack.push({ thoughtId: thought.children[i], parent: nodeStructure });
      }
    }
    
    return {
      treeId: tree.id,
      goal: tree.goal,
      maxDepth: tree.maxDepth,
      structure: structureMap.get(tree.rootId) || null
    };
  }

  getBestThoughts(treeId: string, limit: number = 5, sortBy: 'evaluation' | 'creativity' | 'risk' | 'combined' = 'evaluation'): Thought[] {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }
    
    const evaluatedThoughts = Array.from(tree.thoughts.values())
      .filter(t => (t.state === 'evaluated' || t.state === 'selected') && t.evaluation !== null);
    
    // Sort based on the specified criteria
    evaluatedThoughts.sort((a, b) => {
      switch (sortBy) {
        case 'creativity':
          return (b.creativity || 0) - (a.creativity || 0);
        case 'risk':
          return (a.risk || 0) - (b.risk || 0); // Lower risk is better
        case 'combined':
          // Combined score: weighted average of evaluation, creativity, and inverse risk
          const scoreA = (a.evaluation || 0) * 0.5 + (a.creativity || 0) * 0.3 + (100 - (a.risk || 0)) * 0.2;
          const scoreB = (b.evaluation || 0) * 0.5 + (b.creativity || 0) * 0.3 + (100 - (b.risk || 0)) * 0.2;
          return scoreB - scoreA;
        case 'evaluation':
        default:
          return (b.evaluation || 0) - (a.evaluation || 0);
      }
    });
    
    return evaluatedThoughts.slice(0, limit);
  }

  getTreeStats(treeId: string): TreeStats | null {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }
    
    const thoughts = Array.from(tree.thoughts.values());
    const evaluatedThoughts = thoughts.filter(t => t.state === 'evaluated');
    const selectedThoughts = thoughts.filter(t => t.state === 'selected');
    const prunedThoughts = thoughts.filter(t => t.state === 'pruned');
    const maxDepthReached = Math.max(...thoughts.map(t => t.depth));
    
    const thoughtsWithEvaluations = thoughts.filter(t => (t.state === 'evaluated' || t.state === 'selected') && t.evaluation !== null);
    const evaluations = thoughtsWithEvaluations.map(t => t.evaluation || 0);
    const averageEvaluation = evaluations.length > 0 
      ? evaluations.reduce((a, b) => a + b, 0) / evaluations.length 
      : 0;
    
    // Calculate average creativity and risk for thoughts with those fields
    const thoughtsWithCreativity = thoughtsWithEvaluations.filter(t => t.creativity !== null && t.creativity !== undefined);
    const averageCreativity = thoughtsWithCreativity.length > 0
      ? thoughtsWithCreativity.reduce((a, b) => a + (b.creativity || 0), 0) / thoughtsWithCreativity.length
      : undefined;
    
    const thoughtsWithRisk = thoughtsWithEvaluations.filter(t => t.risk !== null && t.risk !== undefined);
    const averageRisk = thoughtsWithRisk.length > 0
      ? thoughtsWithRisk.reduce((a, b) => a + (b.risk || 0), 0) / thoughtsWithRisk.length
      : undefined;
    
    return {
      totalThoughts: thoughts.length,
      evaluatedThoughts: evaluatedThoughts.length,
      selectedThoughts: selectedThoughts.length,
      prunedThoughts: prunedThoughts.length,
      maxDepthReached,
      averageEvaluation,
      averageCreativity,
      averageRisk,
      usageStats: tree.usageStats
    };
  }

  clearAll(): void {
    this.trees.clear();
  }

  /**
   * Get the configured LLM provider (if any)
   * This allows external code to access the LLM provider for operations like refineThought and selfReflect
   */
  getLLMProvider(): LLMProvider | null {
    return this.config.llmProvider || null;
  }

  /**
   * Refine a thought using the LLM provider
   * @param treeId - The ID of the tree containing the thought
   * @param thoughtId - The ID of the thought to refine
   * @returns The refined thought content
   */
  async refineThought(treeId: string, thoughtId: string): Promise<string> {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }

    const thought = tree.thoughts.get(thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(treeId, thoughtId);
    }

    const llmProvider = this.getLLMProvider();
    if (!llmProvider?.refineThought) {
      throw new Error('LLM provider does not support thought refinement');
    }

    const refinedContent = await llmProvider.refineThought(thought.content, tree.goal);
    this.trackUsage(treeId);

    return refinedContent;
  }

  /**
   * Self-reflect on a thought using the LLM provider
   * @param treeId - The ID of the tree containing the thought
   * @param thoughtId - The ID of the thought to reflect on
   * @param feedback - Optional feedback to guide the reflection
   * @returns The critique and optionally an improved thought
   */
  async selfReflectThought(
    treeId: string,
    thoughtId: string,
    feedback?: string
  ): Promise<{ critique: string; improvedThought?: string }> {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }

    const thought = tree.thoughts.get(thoughtId);
    if (!thought) {
      throw new ThoughtNotFoundError(treeId, thoughtId);
    }

    const llmProvider = this.getLLMProvider();
    if (!llmProvider?.selfReflect) {
      throw new Error('LLM provider does not support self-reflection');
    }

    const reflectionFeedback = feedback || 'Critique this thought and suggest improvements';
    const critique = await llmProvider.selfReflect(thought.content, reflectionFeedback);
    this.trackUsage(treeId);

    return { critique };
  }

  /**
   * Suggest next actions based on the current state of the tree
   * @param treeId - The ID of the tree to analyze
   * @param focusThoughtId - Optional thought ID to focus recommendations on
   * @param maxSuggestions - Maximum number of suggestions to return (default: 5)
   * @returns Array of prioritized action suggestions
   */
  suggestNextActions(treeId: string, focusThoughtId?: string, maxSuggestions: number = 5): NextActionSuggestion[] {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new TreeNotFoundError(treeId);
    }

    const suggestions: NextActionSuggestion[] = [];
    const thoughts = Array.from(tree.thoughts.values());
    const stats = this.getTreeStats(treeId);

    // Count thoughts by state
    const pendingThoughts = thoughts.filter(t => t.state === 'pending');
    const evaluatedThoughts = thoughts.filter(t => t.state === 'evaluated');
    const selectedThoughts = thoughts.filter(t => t.state === 'selected');
    const prunedThoughts = thoughts.filter(t => t.state === 'pruned');
    const verifiedThoughts = thoughts.filter(t => t.verified);

    // Count low evaluation thoughts
    const lowEvalThoughts = evaluatedThoughts.filter(t => t.evaluation !== null && t.evaluation < 40);
    const highRiskThoughts = evaluatedThoughts.filter(t => t.risk !== null && t.risk !== undefined && t.risk > 70);

    // Check if approaching max depth
    if (!stats) {
      return [];
    }
    const depthProgress = stats.maxDepthReached / tree.maxDepth;
    const nearMaxDepth = depthProgress > 0.8;

    // Get best thoughts
    const bestThoughts = this.getBestThoughts(treeId, 3, 'evaluation');

    // Suggestion 1: Generate children from best thought if there are pending thoughts
    if (bestThoughts.length > 0 && pendingThoughts.length > 0) {
      const bestThought = bestThoughts[0];
      suggestions.push({
        action: 'generate_and_evaluate_children',
        targetThoughtId: bestThought.id,
        reason: `There are ${pendingThoughts.length} pending thoughts. Generating and evaluating children from the current best thought (eval: ${bestThought.evaluation}) can help explore more promising directions.`,
        priority: 'high'
      });
    }

    // Suggestion 2: Prune low-value thoughts
    if (lowEvalThoughts.length > 3) {
      suggestions.push({
        action: 'prune_tree',
        reason: `${lowEvalThoughts.length} thoughts have evaluation below 40. Pruning low-value thoughts can reduce noise and improve focus.`,
        priority: lowEvalThoughts.length > 10 ? 'high' : 'medium'
      });
    }

    // Suggestion 3: Evaluate pending thoughts
    if (pendingThoughts.length > 0) {
      suggestions.push({
        action: 'evaluate_thought',
        targetThoughtId: pendingThoughts[0].id,
        reason: `${pendingThoughts.length} thoughts are pending evaluation. Evaluating them will provide data for better decision-making.`,
        priority: pendingThoughts.length > 5 ? 'high' : 'medium'
      });
    }

    // Suggestion 4: Verify good thoughts for selection
    const unverifiedGoodThoughts = evaluatedThoughts.filter(
      t => !t.verified && t.evaluation !== null && t.evaluation > 60
    );
    if (unverifiedGoodThoughts.length > 0) {
      suggestions.push({
        action: 'verify_thought',
        targetThoughtId: unverifiedGoodThoughts[0].id,
        reason: `${unverifiedGoodThoughts.length} good thoughts (eval > 60) are not yet verified. Verification is required before selection.`,
        priority: 'high'
      });
    }

    // Suggestion 5: Select verified thoughts
    const verifiedUnselectedThoughts = verifiedThoughts.filter(t => t.state !== 'selected');
    if (verifiedUnselectedThoughts.length > 0) {
      suggestions.push({
        action: 'select_thought',
        targetThoughtId: verifiedUnselectedThoughts[0].id,
        reason: `${verifiedUnselectedThoughts.length} verified thoughts are not yet selected. Selecting the best one marks it for further exploration.`,
        priority: 'medium'
      });
    }

    // Suggestion 6: Backtrack if near max depth with no good solutions
    if (nearMaxDepth && bestThoughts.length > 0 && (bestThoughts[0].evaluation || 0) < 70) {
      suggestions.push({
        action: 'backtrack',
        targetThoughtId: bestThoughts[0].id,
        reason: `Near max depth (${stats.maxDepthReached}/${tree.maxDepth}) but best evaluation is only ${bestThoughts[0].evaluation}. Consider backtracking to explore alternative branches.`,
        priority: 'medium'
      });
    }

    // Suggestion 7: Refine low-evaluated thoughts
    if (evaluatedThoughts.length > 0 && stats.averageEvaluation < 50) {
      const lowEvalThought = evaluatedThoughts
        .filter(t => t.evaluation !== null)
        .sort((a, b) => (a.evaluation || 0) - (b.evaluation || 0))[0];
      if (lowEvalThought && this.config.llmProvider?.refineThought) {
        suggestions.push({
          action: 'refine_thought',
          targetThoughtId: lowEvalThought.id,
          reason: `Average evaluation is ${stats.averageEvaluation.toFixed(1)}. Refining low-evaluated thoughts may improve their quality.`,
          priority: 'low'
        });
      }
    }

    // Suggestion 8: Self-reflect on best thought for improvement
    if (bestThoughts.length > 0 && this.config.llmProvider?.selfReflect) {
      suggestions.push({
        action: 'self_reflect_thought',
        targetThoughtId: bestThoughts[0].id,
        reason: 'Self-reflection on the best thought can identify areas for improvement and generate better alternatives.',
        priority: 'low'
      });
    }

    // Suggestion 9: Address high-risk thoughts
    if (highRiskThoughts.length > 0) {
      suggestions.push({
        action: 'prune_tree',
        reason: `${highRiskThoughts.length} thoughts have high risk (>70). Consider pruning by risk threshold to focus on safer options.`,
        priority: 'medium'
      });
    }

    // Suggestion 10: Use exploration strategy if tree is large
    if (thoughts.length > 20 && !nearMaxDepth) {
      suggestions.push({
        action: 'explore_with_strategy',
        reason: `Tree has ${thoughts.length} thoughts. Using a systematic exploration strategy (BFS, DFS, beam, or best-first) can efficiently traverse the space.`,
        priority: 'low'
      });
    }

    // If focusThoughtId is provided, prioritize suggestions related to it
    if (focusThoughtId) {
      const focusThought = tree.thoughts.get(focusThoughtId);
      if (focusThought) {
        suggestions.sort((a, b) => {
          const aMatches = a.targetThoughtId === focusThoughtId ? 1 : 0;
          const bMatches = b.targetThoughtId === focusThoughtId ? 1 : 0;
          return bMatches - aMatches;
        });
      }
    }

    // Sort by priority and return limited results
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions.slice(0, maxSuggestions);
  }

  exploreWithStrategy(params: ExploreWithStrategyParams): ExplorationResult {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const maxThoughts = params.maxThoughts || 100;
    const beamWidth = params.beamWidth || 3;
    const stopCriteria: StopCriteria = params.stopCriteria || {};

    let thoughtsExplored = 0;
    let maxDepthReached = 0;
    let bestThoughtId: string | null = null;
    let bestEvaluation: number | null = null;
    let stoppedReason = '';

    switch (params.strategy) {
      case 'bfs':
        this.bfsStrategy(tree, maxThoughts, stopCriteria, (explored, depth, bestId, bestEval, reason) => {
          thoughtsExplored = explored;
          maxDepthReached = depth;
          bestThoughtId = bestId;
          bestEvaluation = bestEval;
          stoppedReason = reason;
        });
        break;

      case 'dfs':
        this.dfsStrategy(tree, maxThoughts, stopCriteria, (explored, depth, bestId, bestEval, reason) => {
          thoughtsExplored = explored;
          maxDepthReached = depth;
          bestThoughtId = bestId;
          bestEvaluation = bestEval;
          stoppedReason = reason;
        });
        break;

      case 'beam':
        this.beamSearchStrategy(tree, maxThoughts, beamWidth, stopCriteria, (explored, depth, bestId, bestEval, reason) => {
          thoughtsExplored = explored;
          maxDepthReached = depth;
          bestThoughtId = bestId;
          bestEvaluation = bestEval;
          stoppedReason = reason;
        });
        break;

      case 'best_first':
        this.bestFirstSearchStrategy(tree, maxThoughts, stopCriteria, (explored, depth, bestId, bestEval, reason) => {
          thoughtsExplored = explored;
          maxDepthReached = depth;
          bestThoughtId = bestId;
          bestEvaluation = bestEval;
          stoppedReason = reason;
        });
        break;

      default:
        throw new InvalidStrategyError(params.strategy);
    }

    tree.updatedAt = new Date().toISOString();

    return {
      thoughtsExplored,
      thoughtsCreated: 0,
      maxDepthReached,
      bestThoughtId,
      bestEvaluation,
      stoppedReason
    };
  }

  /**
   * Breadth-First Search strategy - explores all thoughts at current depth before moving deeper
   */
  private bfsStrategy(
    tree: Tree,
    maxThoughts: number,
    stopCriteria: StopCriteria,
    callback: StrategyCallback
  ): void {
    const config: TraversalStrategyConfig<string[], string> = {
      initialData: [tree.rootId],
      getNext: (data) => data.shift()!,
      addChildren: (data, children) => {
        for (const childId of children) {
          data.push(childId);
        }
      },
      hasMore: (data) => data.length > 0,
      shouldSkipVisited: true
    };
    this.executeStrategy(tree, maxThoughts, stopCriteria, config, callback);
  }

  /**
   * Depth-First Search strategy - explores as deep as possible along each branch before backtracking
   */
  private dfsStrategy(
    tree: Tree,
    maxThoughts: number,
    stopCriteria: StopCriteria,
    callback: StrategyCallback
  ): void {
    const config: TraversalStrategyConfig<string[], string> = {
      initialData: [tree.rootId],
      getNext: (data) => data.pop()!,
      addChildren: (data, children) => {
        for (let i = children.length - 1; i >= 0; i--) {
          data.push(children[i]);
        }
      },
      hasMore: (data) => data.length > 0,
      shouldSkipVisited: true
    };
    this.executeStrategy(tree, maxThoughts, stopCriteria, config, callback);
  }

  /**
   * Beam Search strategy - keeps only top-k thoughts at each level based on evaluation scores
   * Note: This strategy uses level-based traversal and doesn't fit the queue model cleanly
   */
  private beamSearchStrategy(
    tree: Tree,
    maxThoughts: number,
    beamWidth: number,
    stopCriteria: StopCriteria,
    callback: StrategyCallback
  ): void {
    let thoughtsExplored = 0;
    let maxDepthReached = 0;
    let bestThoughtId: string | null = null;
    let bestEvaluation: number | null = null;
    let stoppedReason = '';

    let currentLevel: string[] = [tree.rootId];
    const visited = new Set<string>();

    while (currentLevel.length > 0 && thoughtsExplored < maxThoughts) {
      const nextLevel: string[] = [];

      for (const currentId of currentLevel) {
        if (visited.has(currentId)) continue;

        visited.add(currentId);
        const currentThought = tree.thoughts.get(currentId);
        if (!currentThought) continue;

        thoughtsExplored++;
        maxDepthReached = Math.max(maxDepthReached, currentThought.depth);

        if (currentThought.evaluation !== null) {
          if (bestEvaluation === null || currentThought.evaluation > bestEvaluation) {
            bestEvaluation = currentThought.evaluation;
            bestThoughtId = currentThought.id;
          }
        }

        if (this.shouldStop(currentThought.depth, thoughtsExplored, bestEvaluation, maxThoughts, stopCriteria)) {
          stoppedReason = this.getStopReason(currentThought.depth, thoughtsExplored, bestEvaluation, maxThoughts, stopCriteria);
          break;
        }

        for (const childId of currentThought.children) {
          if (!visited.has(childId)) {
            nextLevel.push(childId);
          }
        }
      }

      if (stoppedReason) break;

      if (nextLevel.length > beamWidth) {
        nextLevel.sort((a, b) => {
          const thoughtA = tree.thoughts.get(a);
          const thoughtB = tree.thoughts.get(b);
          const evalA = thoughtA?.evaluation ?? -Infinity;
          const evalB = thoughtB?.evaluation ?? -Infinity;
          return evalB - evalA;
        });
        currentLevel = nextLevel.slice(0, beamWidth);
      } else {
        currentLevel = nextLevel;
      }
    }

    callback(thoughtsExplored, maxDepthReached, bestThoughtId, bestEvaluation, stoppedReason);
  }

  /**
   * Best-First Search strategy - always explores the thought with highest evaluation score next
   */
  private bestFirstSearchStrategy(
    tree: Tree,
    maxThoughts: number,
    stopCriteria: StopCriteria,
    callback: StrategyCallback
  ): void {
    interface PriorityItem {
      id: string;
      priority: number;
    }

    const config: TraversalStrategyConfig<PriorityItem[], PriorityItem> = {
      initialData: [{ id: tree.rootId, priority: 0 }],
      getNext: (data) => {
        data.sort((a, b) => b.priority - a.priority);
        return data.shift()!;
      },
      addChildren: (data, children, tree) => {
        for (const childId of children) {
          const childThought = tree.thoughts.get(childId);
          const priority = childThought?.evaluation ?? 0;
          data.push({ id: childId, priority });
        }
      },
      hasMore: (data) => data.length > 0,
      shouldSkipVisited: true,
      extractId: (item) => item.id
    };
    this.executeStrategy(tree, maxThoughts, stopCriteria, config, callback);
  }

  /**
   * Generic strategy execution engine - implements the core traversal logic
   * Used by BFS, DFS, and Best-First strategies
   */
  private executeStrategy<TData, TItem>(
    tree: Tree,
    maxThoughts: number,
    stopCriteria: StopCriteria,
    strategy: TraversalStrategyConfig<TData, TItem>,
    callback: StrategyCallback
  ): void {
    let thoughtsExplored = 0;
    let maxDepthReached = 0;
    let bestThoughtId: string | null = null;
    let bestEvaluation: number | null = null;
    let stoppedReason = '';

    const data = strategy.initialData;
    const visited = new Set<string>();

    while (strategy.hasMore(data) && thoughtsExplored < maxThoughts) {
      const currentItem = strategy.getNext(data);
      if (!currentItem) break;

      const currentId = strategy.extractId ? strategy.extractId(currentItem) : currentItem as unknown as string;

      if (strategy.shouldSkipVisited && visited.has(currentId)) continue;

      visited.add(currentId);
      const currentThought = tree.thoughts.get(currentId);
      if (!currentThought) continue;

      thoughtsExplored++;
      maxDepthReached = Math.max(maxDepthReached, currentThought.depth);

      if (currentThought.evaluation !== null) {
        if (bestEvaluation === null || currentThought.evaluation > bestEvaluation) {
          bestEvaluation = currentThought.evaluation;
          bestThoughtId = currentThought.id;
        }
      }

      if (this.shouldStop(currentThought.depth, thoughtsExplored, bestEvaluation, maxThoughts, stopCriteria)) {
        stoppedReason = this.getStopReason(currentThought.depth, thoughtsExplored, bestEvaluation, maxThoughts, stopCriteria);
        break;
      }

      const unvisitedChildren = currentThought.children.filter(id => !visited.has(id));
      if (unvisitedChildren.length > 0) {
        strategy.addChildren(data, unvisitedChildren, tree);
      }
    }

    callback(thoughtsExplored, maxDepthReached, bestThoughtId, bestEvaluation, stoppedReason);
  }

  /**
   * Check if traversal should stop based on stop criteria
   */
  private shouldStop(
    depth: number,
    thoughtCount: number,
    bestEval: number | null,
    maxThoughts: number,
    stopCriteria: StopCriteria
  ): boolean {
    if (thoughtCount >= maxThoughts) return true;
    if (stopCriteria.maxDepth && depth >= stopCriteria.maxDepth) return true;
    if (stopCriteria.targetThoughtCount && thoughtCount >= stopCriteria.targetThoughtCount) return true;
    if (stopCriteria.minEvaluation && bestEval !== null && bestEval >= stopCriteria.minEvaluation) return true;
    return false;
  }

  /**
   * Get human-readable reason for stopping traversal
   */
  private getStopReason(
    depth: number,
    thoughtCount: number,
    bestEval: number | null,
    maxThoughts: number,
    stopCriteria: StopCriteria
  ): string {
    if (thoughtCount >= maxThoughts) return 'Reached maxThoughts limit';
    if (stopCriteria.maxDepth && depth >= stopCriteria.maxDepth) return 'Reached maxDepth limit';
    if (stopCriteria.targetThoughtCount && thoughtCount >= stopCriteria.targetThoughtCount) return 'Reached targetThoughtCount';
    if (stopCriteria.minEvaluation && bestEval !== null && bestEval >= stopCriteria.minEvaluation) return 'Reached minEvaluation threshold';
    return 'Unknown reason';
  }

  proposeAndEvaluate(params: ProposeAndEvaluateParams): Thought | null {
    if (params.score < 0 || params.score > 100) {
      throw new InvalidEvaluationError(params.score);
    }

    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const parentThought = tree.thoughts.get(params.parentId);
    if (!parentThought) {
      throw new ThoughtNotFoundError(params.treeId, params.parentId);
    }

    if (parentThought.depth >= tree.maxDepth) {
      throw new MaxDepthReachedError(params.treeId, parentThought.depth, tree.maxDepth);
    }

    const childId = uuidv4();
    const now = new Date().toISOString();

    const childThought: Thought = {
      id: childId,
      content: params.content,
      parentId: params.parentId,
      children: [],
      evaluation: params.score,
      state: 'evaluated',
      depth: parentThought.depth + 1,
      createdAt: now,
      metadata: params.metadata
    };

    // Store multi-criteria evaluation fields if provided
    if (params.creativity !== undefined) {
      childThought.creativity = params.creativity;
    }
    if (params.risk !== undefined) {
      childThought.risk = params.risk;
    }
    if (params.criteriaScores) {
      childThought.criteriaScores = params.criteriaScores;
    }

    if (params.reasoning) {
      childThought.metadata = childThought.metadata || {};
      childThought.metadata.evaluationReasoning = params.reasoning;
    }

    parentThought.children.push(childId);
    tree.thoughts.set(childId, childThought);
    tree.updatedAt = now;

    return childThought;
  }

  async generateChildren(params: GenerateChildrenParams): Promise<GeneratedChild[]> {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const parentThought = tree.thoughts.get(params.parentId);
    if (!parentThought) {
      throw new ThoughtNotFoundError(params.treeId, params.parentId);
    }

    if (parentThought.depth >= tree.maxDepth) {
      throw new MaxDepthReachedError(params.treeId, parentThought.depth, tree.maxDepth);
    }

    const generatedChildren: GeneratedChild[] = [];
    const numChildren = params.numChildren || 3;

    let thoughtContents: string[] = [];

    if (this.config.llmProvider) {
      const context = this.buildRichContextForGeneration(tree, parentThought, numChildren);
      const temperature = this.calculateTemperature(parentThought.depth, tree.maxDepth);
      thoughtContents = await this.config.llmProvider.generateThoughts(
        params.diversityPrompt || 'Generate diverse child thoughts',
        numChildren,
        context,
        temperature
      );
      this.trackUsage(params.treeId);
    } else if (this.config.strictLLM) {
      throw new Error('LLM provider not configured. Set strictLLM to false to use placeholder thoughts, or configure an LLM provider. See examples/llm-providers/ for implementation examples.');
    } else {
      thoughtContents = Array.from({ length: numChildren }, (_, i) =>
        `Child thought ${i + 1} (LLM provider not configured - using placeholder. Configure an LLM provider or set strictLLM to false. See examples/llm-providers/ for implementation examples.)`
      );
    }

    for (let i = 0; i < thoughtContents.length; i++) {
      const childId = uuidv4();
      const now = new Date().toISOString();

      const childThought: Thought = {
        id: childId,
        content: thoughtContents[i],
        parentId: params.parentId,
        children: [],
        evaluation: null,
        state: 'pending',
        depth: parentThought.depth + 1,
        createdAt: now,
        metadata: params.metadata
      };

      parentThought.children.push(childId);
      tree.thoughts.set(childId, childThought);
      tree.updatedAt = now;

      generatedChildren.push({
        thoughtId: childId,
        content: childThought.content,
        depth: childThought.depth
      });
    }

    return generatedChildren;
  }

  async generateChildrenAndEvaluate(
    params: GenerateChildrenParams,
    defaultScore?: number,
    useLLMJudge?: boolean
  ): Promise<GeneratedChild[]> {
    if (!this.config.llmProvider) {
      throw new Error('LLM provider not configured. generateChildrenAndEvaluate requires an LLM provider to be configured.');
    }

    // First generate the children (now with rich context)
    const generatedChildren = await this.generateChildren(params);

    // Fetch tree once before the loop (performance optimization)
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    // Then evaluate each child
    for (const child of generatedChildren) {
      const thought = tree.thoughts.get(child.thoughtId);
      if (!thought) {
        continue;
      }

      let score: number;
      let creativity: number | undefined;
      let risk: number | undefined;
      let criteriaScores: Record<string, number> | undefined;
      let reasoning: string | undefined;

      if (useLLMJudge && this.config.llmProvider) {
        // Build rich context for evaluation
        const context = this.buildRichContextForGeneration(tree, thought, 1);

        // Prefer structured evaluation if available
        if (this.config.llmProvider.evaluateThoughtStructured) {
          try {
            const structuredResult = await this.config.llmProvider.evaluateThoughtStructured(
              thought.content,
              tree.goal,
              context
            );
            this.trackUsage(params.treeId);

            // Extract fields from structured result
            score = structuredResult.overallScore;
            creativity = structuredResult.creativity;
            risk = structuredResult.risk;
            criteriaScores = structuredResult.criteriaScores;
            reasoning = structuredResult.reasoning;
          } catch (error) {
            // Fallback to text-based parsing if structured evaluation fails
            logger.warn(`Structured evaluation failed, falling back to text parsing: ${error instanceof Error ? error.message : String(error)}`);
            const parsed = await this.parseTextEvaluation(thought.content, tree.goal, context, params.treeId, defaultScore);
            score = parsed.score;
            creativity = parsed.creativity;
            risk = parsed.risk;
            reasoning = parsed.reasoning;
          }
        } else {
          // Fallback to text-based parsing if structured evaluation not available
          const parsed = await this.parseTextEvaluation(thought.content, tree.goal, context, params.treeId, defaultScore);
          score = parsed.score;
          creativity = parsed.creativity;
          risk = parsed.risk;
          reasoning = parsed.reasoning;
        }
      } else {
        // Use default score
        score = defaultScore !== undefined ? defaultScore : 50;
      }

      // Evaluate the thought with all available fields
      this.evaluateThought({
        treeId: params.treeId,
        thoughtId: child.thoughtId,
        score: score,
        creativity: creativity,
        risk: risk,
        criteriaScores: criteriaScores,
        reasoning: reasoning
      });
    }

    return generatedChildren;
  }

  /**
   * Parse text-based evaluation from LLM response (fallback when structured evaluation unavailable)
   */
  private async parseTextEvaluation(
    thought: string,
    goal: string,
    context: string,
    treeId: string,
    defaultScore?: number
  ): Promise<{ score: number; creativity?: number; risk?: number; reasoning?: string }> {
    if (!this.config.llmProvider) {
      return {
        score: defaultScore !== undefined ? defaultScore : 50
      };
    }

    const judgePrompt = `You are an expert evaluator in a Tree of Thoughts reasoning system.

Goal: "${goal}"

Thought to evaluate:
"${thought}"

Context:
${context}

Please evaluate how promising this thought is for solving the goal.
Respond in exactly this format:
Score: <number between 0 and 100>
Creativity: <number between 0 and 100>
Risk: <number between 0 and 100>
Reasoning: <1-2 sentences explaining your evaluation>`;

    const evaluations = await this.config.llmProvider.generateThoughts(judgePrompt, 1);
    this.trackUsage(treeId);

    // Parse the score, creativity, risk, and reasoning from the LLM response
    const scoreMatch = evaluations[0].match(/Score:\s*(\d{1,3})/i);
    const creativityMatch = evaluations[0].match(/Creativity:\s*(\d{1,3})/i);
    const riskMatch = evaluations[0].match(/Risk:\s*(\d{1,3})/i);
    const reasoningMatch = evaluations[0].match(/Reasoning:\s*(.+?)(?:\n|$)/i);

    const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : (defaultScore || 50);
    const creativity = creativityMatch ? Math.min(100, Math.max(0, parseInt(creativityMatch[1], 10))) : undefined;
    const risk = riskMatch ? Math.min(100, Math.max(0, parseInt(riskMatch[1], 10))) : undefined;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : undefined;

    return { score, creativity, risk, reasoning };
  }

  /**
   * Visualize a tree in the specified format (ASCII, Mermaid, or DOT)
   */
  visualizeTree(params: VisualizeTreeParams): string {
    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const format = params.format || 'ascii';

    switch (format) {
      case 'ascii':
        return this.renderAsciiTree(tree);
      case 'mermaid':
        return this.renderMermaidTree(tree);
      case 'dot':
        return this.renderDotTree(tree);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Render tree as ASCII art
   */
  private renderAsciiTree(tree: Tree): string {
    const lines: string[] = [];
    lines.push(`Tree: ${tree.goal}`);
    lines.push(`ID: ${tree.id}`);
    lines.push('');

    // Add creativity/risk summary for evaluated thoughts
    const stats = this.getTreeStats(tree.id);
    if (stats && (stats.averageCreativity !== undefined || stats.averageRisk !== undefined)) {
      lines.push(`Evaluated Thoughts Summary:`);
      if (stats.averageCreativity !== undefined) {
        lines.push(`  Average Creativity: ${stats.averageCreativity.toFixed(1)}/100`);
      }
      if (stats.averageRisk !== undefined) {
        lines.push(`  Average Risk: ${stats.averageRisk.toFixed(1)}/100`);
      }
      lines.push('');
    }

    lines.push(`Legend: ○=pending ✓=evaluated ★=selected ✗=pruned [C:creativity] [R:risk]`);
    lines.push('');

    const renderNode = (thoughtId: string, prefix: string, isLast: boolean): void => {
      const thought = tree.thoughts.get(thoughtId);
      if (!thought) return;

      const stateIcon = this.getStateIcon(thought.state);
      const label = this.formatThoughtLabel(thought, true);
      
      // Add creativity/risk badges with clearer formatting
      let badges = '';
      if (thought.creativity !== undefined && thought.creativity !== null) {
        const creativityLevel = thought.creativity >= 80 ? '★' : thought.creativity >= 50 ? '○' : '○';
        badges += ` [C:${thought.creativity}${creativityLevel}]`;
      }
      if (thought.risk !== undefined && thought.risk !== null) {
        const riskLevel = thought.risk >= 70 ? '⚠' : thought.risk >= 40 ? '○' : '✓';
        badges += ` [R:${thought.risk}${riskLevel}]`;
      }
      
      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${stateIcon} ${label}${badges}`);

      const children = thought.children;
      for (let i = 0; i < children.length; i++) {
        const isLastChild = i === children.length - 1;
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        renderNode(children[i], childPrefix, isLastChild);
      }
    };

    renderNode(tree.rootId, '', true);
    return lines.join('\n');
  }

  /**
   * Render tree as Mermaid flowchart
   */
  private renderMermaidTree(tree: Tree): string {
    const lines: string[] = [];
    lines.push('flowchart TD');
    lines.push(`    Root["${tree.goal}"]`);
    lines.push('');
    lines.push('    classDef pending fill:#f0f0f0,stroke:#999,stroke-width:1px');
    lines.push('    classDef evaluated fill:#90EE90,stroke:#228B22,stroke-width:2px');
    lines.push('    classDef selected fill:#FFD700,stroke:#DAA520,stroke-width:2px');
    lines.push('    classDef pruned fill:#FFB6C1,stroke:#DC143C,stroke-width:2px');
    lines.push('');

    const renderNode = (thoughtId: string, parentId: string | null): void => {
      const thought = tree.thoughts.get(thoughtId);
      if (!thought) return;

      const nodeId = `N${thoughtId.substring(0, 8)}`;
      const stateStyle = this.getStateStyle(thought.state);
      const label = this.formatThoughtLabel(thought, false);
      const content = label.replace(/"/g, '\\"').substring(0, this.MAX_CONTENT_LENGTH);
      const verificationSuffix = thought.verified ? ' ✓' : '';
      
      // Add creativity/risk badges with visual indicators
      let badges = '';
      if (thought.creativity !== undefined && thought.creativity !== null) {
        const creativityIcon = thought.creativity >= 80 ? '⭐' : thought.creativity >= 50 ? '○' : '○';
        badges += ` | C:${thought.creativity}${creativityIcon}`;
      }
      if (thought.risk !== undefined && thought.risk !== null) {
        const riskIcon = thought.risk >= 70 ? '⚠️' : thought.risk >= 40 ? '○' : '✓';
        badges += ` | R:${thought.risk}${riskIcon}`;
      }
      
      const nodeLabel = badges ? `${content}${verificationSuffix}${badges}` : `${content}${verificationSuffix}`;
      lines.push(`    ${nodeId}["${nodeLabel}"]${stateStyle}`);

      if (parentId) {
        const parentNodeId = `N${parentId.substring(0, 8)}`;
        lines.push(`    ${parentNodeId} --> ${nodeId}`);
      }

      for (const childId of thought.children) {
        renderNode(childId, thoughtId);
      }
    };

    const rootThought = tree.thoughts.get(tree.rootId);
    if (rootThought) {
      const rootNodeId = `N${rootThought.id.substring(0, 8)}`;
      const rootLabel = this.formatThoughtLabel(rootThought, false);
      const rootContent = rootLabel.replace(/"/g, '\\"').substring(0, this.MAX_CONTENT_LENGTH);
      const rootVerificationSuffix = rootThought.verified ? ' ✓' : '';
      lines.push(`    ${rootNodeId}["${rootContent}${rootVerificationSuffix}"]${this.getStateStyle(rootThought.state)}`);
      lines.push(`    Root --> ${rootNodeId}`);
      
      for (const childId of rootThought.children) {
        renderNode(childId, rootThought.id);
      }
    }

    return lines.join('\n');
  }

  /**
   * Render tree as DOT format (Graphviz)
   */
  private renderDotTree(tree: Tree): string {
    const lines: string[] = [];
    lines.push('digraph TreeOfThoughts {');
    lines.push('  rankdir=TB;');
    lines.push(`  label="${tree.goal}";`);
    lines.push('');
    lines.push('  // Legend for state colors');
    lines.push('  // pending=lightgray, evaluated=lightgreen, selected=gold, pruned=lightcoral');
    lines.push('');

    const renderNode = (thoughtId: string, parentId: string | null): void => {
      const thought = tree.thoughts.get(thoughtId);
      if (!thought) return;

      const nodeId = `N${thoughtId.substring(0, 8)}`;
      const stateColor = this.getStateColor(thought.state);
      const label = this.formatThoughtLabel(thought, false);
      const content = label.replace(/"/g, '\\"').substring(0, this.MAX_CONTENT_LENGTH);
      const verificationSuffix = thought.verified ? '\\n✓ verified' : '';
      const style = thought.verified ? 'filled,penwidth=2.0' : 'filled';
      
      // Add creativity/risk badges with visual indicators
      let badges = '';
      if (thought.creativity !== undefined && thought.creativity !== null) {
        const creativityIcon = thought.creativity >= 80 ? '⭐' : thought.creativity >= 50 ? '○' : '○';
        badges += `\\n⚡ C:${thought.creativity}${creativityIcon}`;
      }
      if (thought.risk !== undefined && thought.risk !== null) {
        const riskIcon = thought.risk >= 70 ? '⚠' : thought.risk >= 40 ? '○' : '✓';
        badges += `\\n⚡ R:${thought.risk}${riskIcon}`;
      }
      
      lines.push(`  ${nodeId} [label="${content}${verificationSuffix}${badges}", fillcolor="${stateColor}", style="${style}"];`);

      if (parentId) {
        const parentNodeId = `N${parentId.substring(0, 8)}`;
        lines.push(`  ${parentNodeId} -> ${nodeId};`);
      }

      for (const childId of thought.children) {
        renderNode(childId, thoughtId);
      }
    };

    const rootThought = tree.thoughts.get(tree.rootId);
    if (rootThought) {
      renderNode(rootThought.id, null);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private getStateIcon(state: string): string {
    switch (state) {
      case 'pending': return '○';
      case 'evaluated': return '✓';
      case 'selected': return '★';
      case 'pruned': return '✗';
      default: return '?';
    }
  }

  private getStateStyle(state: string): string {
    switch (state) {
      case 'pending': return ':::pending';
      case 'evaluated': return ':::evaluated';
      case 'selected': return ':::selected';
      case 'pruned': return ':::pruned';
      default: return '';
    }
  }

  private getStateColor(state: string): string {
    switch (state) {
      case 'pending': return 'lightgray';
      case 'evaluated': return 'lightgreen';
      case 'selected': return 'gold';
      case 'pruned': return 'lightcoral';
      default: return 'white';
    }
  }
}
