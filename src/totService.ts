import { Thought, Tree, CreateTreeParams, AddChildParams, EvaluateParams, SelectParams, VerifyParams, BacktrackParams, PruneParams, TreeStats, BranchingStrategyType, ExploreWithStrategyParams, ExplorationResult, ProposeAndEvaluateParams, GenerateChildrenParams, GeneratedChild, ToTServiceConfig, TreeNotFoundError, ThoughtNotFoundError, MaxDepthReachedError, InvalidEvaluationError, InvalidStrategyError, UnverifiedThoughtError, CycleDetectionError, LLMProvider, StopCriteria, StrategyCallback, TraversalStrategyConfig, VisualizationFormat, VisualizeTreeParams, UsageStats, NextActionSuggestion, MoveSubtreeParams, MoveSubtreeResult, Strategy } from './types.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { validateRequiredString, validateSessionId, validateEvaluationScore, validateNumberRange } from './utils/validators.js';
import { renderMermaid, type RenderResult } from './utils/mermaidRenderer.js';

const logger = {
  info: (message: string) => console.log(`[ToTService] ${message}`),
  error: (message: string) => console.error(`[ToTService] ${message}`),
  warn: (message: string) => console.error(`[ToTService] ${message}`)
};

export { ToTServiceConfig, LLMProvider } from './types.js';

export class ToTService {
  private trees: Map<string, Tree>;
  private strategies: Map<string, Strategy>;
  private storagePath: string;
  private config: ToTServiceConfig;
  private readonly MAX_CONTENT_LENGTH = 50;

  constructor(storagePath: string, config?: ToTServiceConfig) {
    this.trees = new Map();
    this.strategies = new Map();
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
  private buildRichContextForGeneration(tree: Tree, parentThought: Thought, numChildren?: number, sessionId?: string): string {
    const lines: string[] = [];

    // Tree goal and configuration
    lines.push(`=== TREE OF THOUGHTS GENERATION CONTEXT ===`);
    lines.push(`Goal: ${tree.goal}`);
    lines.push(`Max Depth: ${tree.maxDepth}`);
    lines.push(`Number of children to generate: ${numChildren || 3}`);
    
    // Include session context if sessionId is provided
    if (sessionId) {
      const sessionTrees = this.getTreesBySession(sessionId);
      if (sessionTrees.length > 1) {
        lines.push(`Session: ${sessionId} (${sessionTrees.length} trees in session)`);
        // Include related goals from other trees in the session
        const otherGoals = sessionTrees
          .filter(t => t.id !== tree.id)
          .map(t => t.goal)
          .slice(0, 3);
        if (otherGoals.length > 0) {
          lines.push(`Related goals in session: ${otherGoals.join('; ')}`);
        }
      }
    }
    
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

      // Load strategies
      this.strategies = new Map();
      for (const [id, strategyData] of Object.entries(parsed.strategies || {})) {
        if (!strategyData || typeof strategyData !== 'object') {
          logger.warn(`Skipping invalid strategy data for ID: ${id}`);
          continue;
        }

        const strategy = strategyData as Strategy;
        
        if (!strategy.id || !strategy.name) {
          logger.warn(`Skipping malformed strategy for ID: ${id}`);
          continue;
        }

        this.strategies.set(id, strategy);
      }

      logger.info(`Loaded ${this.trees.size} trees and ${this.strategies.size} strategies from storage`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet — first run or was deleted. Create it with empty state.
        logger.info(`Storage file not found at ${this.storagePath}. Creating new empty storage.`);
        this.trees = new Map();
        this.strategies = new Map();
        await this.save(); // ← This creates the file
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to load ToT service state: ${message}. Starting with empty state.`);
      this.trees = new Map();
      this.strategies = new Map();
    }
  }

  async save(): Promise<void> {
    const tempPath = `${this.storagePath}.tmp`;
    
    try {
      const serialized: Record<string, any> = {
        trees: {},
        strategies: {}
      };
      
      for (const [id, tree] of this.trees.entries()) {
        serialized.trees[id] = {
          ...tree,
          thoughts: Object.fromEntries(tree.thoughts)
        };
      }
      
      for (const [id, strategy] of this.strategies.entries()) {
        serialized.strategies[id] = strategy;
      }
      
      const jsonData = JSON.stringify(serialized, null, 2);
      
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      
      await fs.writeFile(tempPath, jsonData, 'utf-8');
      
      await fs.rename(tempPath, this.storagePath);
      
      logger.info(`Saved ${this.trees.size} trees and ${this.strategies.size} strategies to storage`);
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

  /**
   * Create a new Tree of Thoughts for systematic reasoning
   * This helps the LLM explore solution paths by maintaining a structured hierarchy of thoughts
   * @param params - Tree creation parameters including goal, root content, and optional sessionId
   * @returns The newly created tree with root thought
   */
  createTree(params: CreateTreeParams): Tree {
    // Validate sessionId if provided
    if (params.sessionId !== undefined) {
      if (typeof params.sessionId !== 'string') {
        throw new Error('sessionId must be a string');
      }
      if (params.sessionId.trim() === '') {
        throw new Error('sessionId cannot be empty');
      }
    }

    const treeId = uuidv4();
    const rootId = uuidv4();
    const now = new Date().toISOString();
    
    // Merge sessionId into metadata if provided for session-based context management
    const treeMetadata = params.metadata ? { ...params.metadata } : {};
    if (params.sessionId) {
      treeMetadata.sessionId = params.sessionId;
    }
    
    const rootThought: Thought = {
      id: rootId,
      content: params.rootContent,
      parentId: null,
      children: [],
      evaluation: null,
      state: 'pending',
      depth: 0,
      createdAt: now,
      updatedAt: now,
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
      metadata: treeMetadata
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

  /**
   * Get all trees associated with a specific session ID
   * This enables session-based context management for long-running reasoning tasks
   * @param sessionId - The session ID to filter trees by
   * @returns Array of trees belonging to the session
   */
  getTreesBySession(sessionId: string): Tree[] {
    return Array.from(this.trees.values()).filter(
      tree => tree.metadata?.sessionId === sessionId
    );
  }

  /**
   * Get all thoughts across all trees for a specific session ID
   * Provides holistic context of all reasoning within a session
   * @param sessionId - The session ID to get thoughts for
   * @returns Array of all thoughts in the session
   */
  getThoughtsBySession(sessionId: string): Thought[] {
    const thoughts: Thought[] = [];
    for (const tree of this.trees.values()) {
      if (tree.metadata?.sessionId === sessionId) {
        thoughts.push(...Array.from(tree.thoughts.values()));
      }
    }
    return thoughts;
  }

  /**
   * Delete all trees and thoughts associated with a specific session ID
   * Useful for cleanup when a session is complete or no longer needed
   * @param sessionId - The session ID to delete trees for
   * @returns Number of trees deleted
   */
  deleteSession(sessionId: string): number {
    let deletedCount = 0;
    const treesToDelete = this.getTreesBySession(sessionId);
    
    for (const tree of treesToDelete) {
      this.trees.delete(tree.id);
      deletedCount++;
    }
    
    return deletedCount;
  }

  deleteTree(treeId: string): boolean {
    return this.trees.delete(treeId);
  }

  /**
   * Add a child thought to an existing thought for deeper reasoning exploration
   * This enables the LLM to branch into alternative solution paths
   * @param params - Parameters including treeId, parentId, content, and optional sessionId
   * @returns The newly created child thought
   * @throws TreeNotFoundError if the tree doesn't exist
   * @throws ThoughtNotFoundError if the parent thought doesn't exist
   * @throws MaxDepthReachedError if the parent is at max depth
   */
  addChildThought(params: AddChildParams): Thought | null {
    // Light validation for direct service calls
    validateRequiredString(params.treeId, 'treeId');
    validateRequiredString(params.parentId, 'parentId');
    validateRequiredString(params.content, 'content');
    validateSessionId(params.sessionId);

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
    
    // Merge sessionId into metadata if provided for session-based context management
    const thoughtMetadata = params.metadata ? { ...params.metadata } : {};
    if (params.sessionId) {
      thoughtMetadata.sessionId = params.sessionId;
    }
    
    const childThought: Thought = {
      id: childId,
      content: params.content,
      parentId: params.parentId,
      children: [],
      evaluation: null,
      state: 'pending',
      depth: parentThought.depth + 1,
      createdAt: now,
      updatedAt: now,
      metadata: thoughtMetadata
    };
    
    parentThought.children.push(childId);
    tree.thoughts.set(childId, childThought);
    tree.updatedAt = now;
    
    return childThought;
  }

  evaluateThought(params: EvaluateParams): Thought | null {
    // Light validation for direct service calls
    validateRequiredString(params.treeId, 'treeId');
    validateRequiredString(params.thoughtId, 'thoughtId');
    validateEvaluationScore(params.score);

    if (params.creativity !== undefined) {
      validateNumberRange(params.creativity, 'creativity', 0, 100);
    }
    if (params.risk !== undefined) {
      validateNumberRange(params.risk, 'risk', 0, 100);
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

    if (thought.verified !== true) {
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
      // Only apply risk-based pruning if the thought has a defined risk value AND is evaluated
      // This check runs after evaluation threshold pruning, so we only prune if not already pruned
      if (params.riskThreshold !== undefined && 
          thought.state === 'evaluated' &&
          thought.risk !== null && 
          thought.risk !== undefined && 
          thought.risk > params.riskThreshold) {
        thought.state = 'pruned';
        prunedCount++;
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

  /**
   * Move a subtree to a new parent within the same tree
   * Performs cycle detection, depth validation, and supports dry-run mode
   * @param params - Parameters including treeId, subtreeRootId, newParentId, and optional dryRun
   * @returns MoveSubtreeResult with validation status, errors, warnings, and affected thoughts
   */
  moveSubtree(params: MoveSubtreeParams): MoveSubtreeResult {
    validateRequiredString(params.treeId, 'treeId');
    validateRequiredString(params.subtreeRootId, 'subtreeRootId');
    validateRequiredString(params.newParentId, 'newParentId');

    const tree = this.trees.get(params.treeId);
    if (!tree) {
      throw new TreeNotFoundError(params.treeId);
    }

    const subtreeRoot = tree.thoughts.get(params.subtreeRootId);
    if (!subtreeRoot) {
      throw new ThoughtNotFoundError(params.treeId, params.subtreeRootId);
    }

    const newParent = tree.thoughts.get(params.newParentId);
    if (!newParent) {
      throw new ThoughtNotFoundError(params.treeId, params.newParentId);
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const affectedThoughtIds: string[] = [];

    // Check if subtree root is the tree root (cannot move root)
    if (params.subtreeRootId === tree.rootId) {
      errors.push('Cannot move the tree root. Use create_tree to create a new tree instead.');
      return {
        valid: false,
        errors,
        movedCount: 0,
        newSubtreeRootDepth: subtreeRoot.depth,
        warnings,
        affectedThoughtIds
      };
    }

    // Check if new parent is the same as current parent
    if (subtreeRoot.parentId === params.newParentId) {
      warnings.push('Subtree is already under the specified parent. No move needed.');
      return {
        valid: true,
        errors,
        movedCount: 0,
        newSubtreeRootDepth: subtreeRoot.depth,
        warnings,
        affectedThoughtIds
      };
    }

    // Cycle detection: new parent must not be a descendant of subtree root
    const isDescendant = this.checkIsDescendant(tree, params.newParentId, params.subtreeRootId);
    if (isDescendant) {
      errors.push(`Cannot move subtree: new parent ${params.newParentId} is a descendant of subtree root ${params.subtreeRootId}, which would create a cycle.`);
      return {
        valid: false,
        errors,
        movedCount: 0,
        newSubtreeRootDepth: subtreeRoot.depth,
        warnings,
        affectedThoughtIds
      };
    }

    // Calculate new depth for subtree root
    const newSubtreeRootDepth = newParent.depth + 1;

    // Check depth limits for the entire subtree
    const maxDepthInSubtree = this.getMaxDepthInSubtree(tree, params.subtreeRootId);
    const newMaxDepth = newSubtreeRootDepth + (maxDepthInSubtree - subtreeRoot.depth);

    if (newMaxDepth > tree.maxDepth) {
      errors.push(`Move would exceed max depth: new max depth would be ${newMaxDepth}, but tree maxDepth is ${tree.maxDepth}`);
      return {
        valid: false,
        errors,
        movedCount: 0,
        newSubtreeRootDepth,
        warnings,
        affectedThoughtIds
      };
    }

    // Collect all thought IDs in the subtree
    const subtreeThoughtIds = this.collectSubtreeThoughtIds(tree, params.subtreeRootId);
    affectedThoughtIds.push(...subtreeThoughtIds);

    // If dry run, return preview without making changes
    if (params.dryRun) {
      warnings.push('This is a dry run. No changes were made.');
      return {
        valid: true,
        errors,
        movedCount: subtreeThoughtIds.length,
        newSubtreeRootDepth,
        warnings,
        affectedThoughtIds
      };
    }

    // Perform the actual move
    const now = new Date().toISOString();

    // Remove subtree root from old parent's children
    if (subtreeRoot.parentId) {
      const oldParent = tree.thoughts.get(subtreeRoot.parentId);
      if (oldParent) {
        oldParent.children = oldParent.children.filter(id => id !== params.subtreeRootId);
        oldParent.updatedAt = now;
      }
    }

    // Add subtree root to new parent's children
    newParent.children.push(params.subtreeRootId);
    newParent.updatedAt = now;

    // Update subtree root's parent
    subtreeRoot.parentId = params.newParentId;
    subtreeRoot.updatedAt = now;
    subtreeRoot.movedAt = now;

    // Recalculate depth and update timestamps for all thoughts in subtree
    this.updateSubtreeDepthsAndTimestamps(tree, params.subtreeRootId, newSubtreeRootDepth, now);

    // Update tree timestamp
    tree.updatedAt = now;

    warnings.push('Subtree moved successfully. Consider re-evaluating thoughts in the new context.');

    return {
      valid: true,
      errors,
      movedCount: subtreeThoughtIds.length,
      newSubtreeRootDepth,
      warnings,
      affectedThoughtIds
    };
  }

  /**
   * Check if a thought is a descendant of another thought
   */
  private checkIsDescendant(tree: Tree, potentialDescendantId: string, ancestorId: string): boolean {
    const visited = new Set<string>();
    const stack: string[] = [ancestorId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (currentId === potentialDescendantId) {
        return true;
      }
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const currentThought = tree.thoughts.get(currentId);
      if (currentThought) {
        for (const childId of currentThought.children) {
          stack.push(childId);
        }
      }
    }

    return false;
  }

  /**
   * Get the maximum depth within a subtree
   */
  private getMaxDepthInSubtree(tree: Tree, subtreeRootId: string): number {
    let maxDepth = 0;
    const stack: string[] = [subtreeRootId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      const currentThought = tree.thoughts.get(currentId);
      if (currentThought) {
        maxDepth = Math.max(maxDepth, currentThought.depth);
        for (const childId of currentThought.children) {
          stack.push(childId);
        }
      }
    }

    return maxDepth;
  }

  /**
   * Collect all thought IDs in a subtree
   */
  private collectSubtreeThoughtIds(tree: Tree, subtreeRootId: string): string[] {
    const ids: string[] = [];
    const stack: string[] = [subtreeRootId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      ids.push(currentId);

      const currentThought = tree.thoughts.get(currentId);
      if (currentThought) {
        for (const childId of currentThought.children) {
          stack.push(childId);
        }
      }
    }

    return ids;
  }

  /**
   * Recalculate depths and update timestamps for all thoughts in a subtree
   */
  private updateSubtreeDepthsAndTimestamps(tree: Tree, subtreeRootId: string, newDepth: number, timestamp: string): void {
    const stack: Array<{ thoughtId: string; depth: number }> = [{ thoughtId: subtreeRootId, depth: newDepth }];

    while (stack.length > 0) {
      const { thoughtId, depth } = stack.pop()!;
      const thought = tree.thoughts.get(thoughtId);
      if (thought) {
        thought.depth = depth;
        thought.updatedAt = timestamp;
        thought.movedAt = timestamp;

        for (const childId of thought.children) {
          stack.push({ thoughtId: childId, depth: depth + 1 });
        }
      }
    }
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

  clearEverything(): void {
    this.trees.clear();
    this.strategies.clear();
  }

  clearTree(treeId: string): boolean {
    return this.trees.delete(treeId);
  }

  clearStrategy(strategyId: string): boolean {
    return this.strategies.delete(strategyId);
  }

  /**
   * Create a new Strategy for grouping related trees
   * @param name - Human-friendly name for the strategy
   * @param description - Optional description of the strategy
   * @returns The newly created strategy
   */
  createStrategy(name: string, description?: string): Strategy {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('Strategy name is required and cannot be empty');
    }

    // Check for duplicate names (case-insensitive)
    const existingStrategy = this.getStrategy(name);
    if (existingStrategy) {
      throw new Error(`Strategy with name "${name}" already exists`);
    }

    const strategyId = uuidv4();
    const now = new Date().toISOString();

    const strategy: Strategy = {
      id: strategyId,
      name: name.trim(),
      description: description?.trim(),
      status: 'active',
      treeIds: [],
      createdAt: now,
      updatedAt: now
    };

    this.strategies.set(strategyId, strategy);
    return strategy;
  }

  /**
   * Get a strategy by ID or name (case-insensitive)
   * @param idOrName - The ID or name of the strategy
   * @returns The strategy if found, undefined otherwise
   */
  getStrategy(idOrName: string): Strategy | undefined {
    // Try to find by ID first
    const byId = this.strategies.get(idOrName);
    if (byId) {
      return byId;
    }

    // Try to find by name (case-insensitive)
    const lowerIdOrName = idOrName.toLowerCase();
    for (const strategy of this.strategies.values()) {
      if (strategy.name.toLowerCase() === lowerIdOrName) {
        return strategy;
      }
    }

    return undefined;
  }

  /**
   * List all strategies, optionally filtered by status
   * @param status - Optional status filter
   * @returns Array of strategies
   */
  listStrategies(status?: string): Strategy[] {
    let strategies = Array.from(this.strategies.values());

    if (status) {
      strategies = strategies.filter(s => s.status === status);
    }

    // Sort by updatedAt (most recent first)
    strategies.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return strategies;
  }

  /**
   * Update a strategy
   * @param id - The ID of the strategy to update
   * @param updates - Partial updates to apply
   * @returns The updated strategy if found, null otherwise
   */
  updateStrategy(id: string, updates: Partial<Strategy>): Strategy | null {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      return null;
    }

    // Validate name uniqueness if being updated
    if (updates.name && updates.name !== strategy.name) {
      const existing = this.getStrategy(updates.name);
      if (existing && existing.id !== id) {
        throw new Error(`Strategy with name "${updates.name}" already exists`);
      }
    }

    // Apply updates
    if (updates.name !== undefined) {
      strategy.name = updates.name.trim();
    }
    if (updates.description !== undefined) {
      strategy.description = updates.description?.trim();
    }
    if (updates.status !== undefined) {
      strategy.status = updates.status;
    }
    if (updates.treeIds !== undefined) {
      strategy.treeIds = updates.treeIds;
    }
    if (updates.metadata !== undefined) {
      strategy.metadata = updates.metadata;
    }

    strategy.updatedAt = new Date().toISOString();
    return strategy;
  }

  /**
   * Delete a strategy
   * @param id - The ID of the strategy to delete
   * @param deleteTrees - If true, also delete all trees in the strategy
   * @returns true if deleted, false if not found
   */
  deleteStrategy(id: string, deleteTrees: boolean = false): boolean {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      return false;
    }

    // If deleteTrees is true, remove all trees in the strategy
    if (deleteTrees) {
      for (const treeId of strategy.treeIds) {
        this.trees.delete(treeId);
      }
    } else {
      // Otherwise, just remove the strategyId from trees
      for (const treeId of strategy.treeIds) {
        const tree = this.trees.get(treeId);
        if (tree) {
          tree.strategyId = undefined;
          tree.updatedAt = new Date().toISOString();
        }
      }
    }

    this.strategies.delete(id);
    return true;
  }

  /**
   * Move a tree to a strategy (lightweight operation)
   * @param treeId - The ID of the tree to move
   * @param strategyIdOrName - The ID or name of the target strategy
   * @returns true if moved successfully, false otherwise
   */
  moveTreeToStrategy(treeId: string, strategyIdOrName: string): boolean {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new Error(`Tree not found: ${treeId}`);
    }

    const strategy = this.getStrategy(strategyIdOrName);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyIdOrName}`);
    }

    // Remove tree from current strategy if it has one
    if (tree.strategyId) {
      const currentStrategy = this.strategies.get(tree.strategyId);
      if (currentStrategy) {
        currentStrategy.treeIds = currentStrategy.treeIds.filter(id => id !== treeId);
        currentStrategy.updatedAt = new Date().toISOString();
      }
    }

    // Add tree to new strategy
    tree.strategyId = strategy.id;
    tree.updatedAt = new Date().toISOString();

    if (!strategy.treeIds.includes(treeId)) {
      strategy.treeIds.push(treeId);
    }
    strategy.updatedAt = new Date().toISOString();

    return true;
  }

  /**
   * Remove a tree from its strategy
   * @param treeId - The ID of the tree to remove
   * @returns true if removed successfully, false otherwise
   */
  removeTreeFromStrategy(treeId: string): boolean {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new Error(`Tree not found: ${treeId}`);
    }

    if (!tree.strategyId) {
      // Tree is not in a strategy, nothing to do
      return true;
    }

    const strategy = this.strategies.get(tree.strategyId);
    if (strategy) {
      strategy.treeIds = strategy.treeIds.filter(id => id !== treeId);
      strategy.updatedAt = new Date().toISOString();
    }

    tree.strategyId = undefined;
    tree.updatedAt = new Date().toISOString();

    return true;
  }

  /**
   * Clone a tree into a strategy (deep copy with new IDs)
   * @param treeId - The ID of the tree to clone
   * @param strategyIdOrName - The ID or name of the target strategy
   * @param options - Optional parameters including namePrefix for the tree goal
   * @returns Object containing the new tree ID
   */
  cloneTreeToStrategy(treeId: string, strategyIdOrName: string, options?: { namePrefix?: string }): { newTreeId: string } {
    const sourceTree = this.trees.get(treeId);
    if (!sourceTree) {
      throw new Error(`Tree not found: ${treeId}`);
    }

    const strategy = this.getStrategy(strategyIdOrName);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyIdOrName}`);
    }

    // Generate new IDs for tree and all thoughts
    const newTreeId = uuidv4();
    const newRootId = uuidv4();
    const now = new Date().toISOString();

    // Create ID mapping for remapping parent/child relationships
    const idMapping = new Map<string, string>();
    idMapping.set(sourceTree.rootId, newRootId);

    // Generate new IDs for all thoughts
    for (const [oldId, thought] of sourceTree.thoughts.entries()) {
      if (oldId !== sourceTree.rootId) {
        idMapping.set(oldId, uuidv4());
      }
    }

    // Create new thoughts with remapped IDs
    const newThoughts = new Map<string, Thought>();
    for (const [oldId, thought] of sourceTree.thoughts.entries()) {
      const newId = idMapping.get(oldId)!;
      const newParentId = thought.parentId ? (idMapping.get(thought.parentId) ?? null) : null;
      const newChildren = thought.children.map(childId => idMapping.get(childId)!);

      const newThought: Thought = {
        id: newId,
        content: thought.content,
        parentId: newParentId,
        children: newChildren,
        evaluation: thought.evaluation,
        creativity: thought.creativity,
        risk: thought.risk,
        criteriaScores: thought.criteriaScores ? { ...thought.criteriaScores } : undefined,
        state: thought.state,
        depth: thought.depth,
        createdAt: now,
        updatedAt: now,
        verified: thought.verified,
        verificationNotes: thought.verificationNotes,
        metadata: thought.metadata ? { ...thought.metadata } : undefined
      };

      newThoughts.set(newId, newThought);
    }

    // Create new tree
    const newTree: Tree = {
      id: newTreeId,
      rootId: newRootId,
      thoughts: newThoughts,
      goal: options?.namePrefix ? `${options.namePrefix} ${sourceTree.goal}` : sourceTree.goal,
      createdAt: now,
      updatedAt: now,
      maxDepth: sourceTree.maxDepth,
      strategyId: strategy.id,
      metadata: sourceTree.metadata ? { ...sourceTree.metadata } : undefined,
      usageStats: sourceTree.usageStats ? { ...sourceTree.usageStats } : undefined
    };

    // Add new tree to storage
    this.trees.set(newTreeId, newTree);

    // Add new tree to strategy
    strategy.treeIds.push(newTreeId);
    strategy.updatedAt = new Date().toISOString();

    return { newTreeId };
  }

  /**
   * Get all trees belonging to a strategy (by ID or name)
   * @param strategyIdOrName - The ID or name of the strategy
   * @returns Array of trees in the strategy
   */
  getTreesByStrategy(strategyIdOrName: string): Tree[] {
    const strategy = this.getStrategy(strategyIdOrName);
    if (!strategy) {
      return [];
    }

    const trees: Tree[] = [];
    for (const treeId of strategy.treeIds) {
      const tree = this.trees.get(treeId);
      if (tree) {
        trees.push(tree);
      }
    }

    return trees;
  }

  /**
   * Get a strategy with its trees and basic statistics
   * @param strategyIdOrName - The ID or name of the strategy
   * @returns Object containing strategy, trees, and stats, or null if not found
   */
  getStrategyWithTrees(strategyIdOrName: string): { strategy: Strategy; trees: Tree[]; stats: { totalThoughts: number; totalTrees: number; averageEvaluation: number } } | null {
    const strategy = this.getStrategy(strategyIdOrName);
    if (!strategy) {
      return null;
    }

    const trees = this.getTreesByStrategy(strategy.id);

    // Calculate statistics
    let totalThoughts = 0;
    let totalEvaluation = 0;
    let evaluatedThoughtsCount = 0;

    for (const tree of trees) {
      totalThoughts += tree.thoughts.size;
      for (const thought of tree.thoughts.values()) {
        if (thought.evaluation !== null) {
          totalEvaluation += thought.evaluation;
          evaluatedThoughtsCount++;
        }
      }
    }

    const averageEvaluation = evaluatedThoughtsCount > 0 ? totalEvaluation / evaluatedThoughtsCount : 0;

    return {
      strategy,
      trees,
      stats: {
        totalThoughts,
        totalTrees: trees.length,
        averageEvaluation
      }
    };
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
   * Suggest next actions based on the current state of the tree or session
   * When sessionId is provided, analyzes all trees in that session for holistic recommendations
   * @param treeId - The ID of the tree to analyze (or primary tree if sessionId provided)
   * @param focusThoughtId - Optional thought ID to focus recommendations on
   * @param maxSuggestions - Maximum number of suggestions to return (default: 5)
   * @param sessionId - Optional session ID to analyze all trees in the session
   * @returns Array of prioritized action suggestions
   */
  suggestNextActions(treeId: string, focusThoughtId?: string, maxSuggestions: number = 5, sessionId?: string): NextActionSuggestion[] {
    // If sessionId provided, analyze all trees in the session for holistic context
    if (sessionId) {
      const sessionTrees = this.getTreesBySession(sessionId);
      if (sessionTrees.length === 0) {
        return [];
      }
      
      // Aggregate suggestions across all trees in the session
      const allSuggestions: NextActionSuggestion[] = [];
      for (const tree of sessionTrees) {
        const treeSuggestions = this.suggestNextActions(tree.id, focusThoughtId, maxSuggestions);
        allSuggestions.push(...treeSuggestions);
      }
      
      // Deduplicate and prioritize by session-level importance
      return this.prioritizeSessionSuggestions(allSuggestions, maxSuggestions);
    }

    // Single tree analysis (original behavior)
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

    // Suggestion 7: Detect recently moved thoughts and suggest re-evaluation
    const recentlyMovedThoughts = thoughts.filter(t => {
      if (!t.movedAt) return false;
      const movedTime = new Date(t.movedAt).getTime();
      const now = Date.now();
      const fiveMinutesMs = 5 * 60 * 1000;
      return (now - movedTime) < fiveMinutesMs;
    });

    if (recentlyMovedThoughts.length > 0) {
      const movedThought = recentlyMovedThoughts[0];
      suggestions.push({
        action: 'evaluate_thought',
        targetThoughtId: movedThought.id,
        reason: `${recentlyMovedThoughts.length} thought(s) were recently moved. Re-evaluating them in their new context is recommended to ensure their relevance and accuracy.`,
        priority: 'high'
      });
    }

    // Suggestion 8: Refine low-evaluated thoughts
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

  /**
   * Helper method to prioritize and deduplicate session-level suggestions
   * @param suggestions - Array of suggestions from multiple trees
   * @param maxSuggestions - Maximum number of suggestions to return
   * @returns Deduplicated and prioritized suggestions
   */
  private prioritizeSessionSuggestions(suggestions: NextActionSuggestion[], maxSuggestions: number): NextActionSuggestion[] {
    // Deduplicate by action type
    const seen = new Set<string>();
    const unique: NextActionSuggestion[] = [];
    
    for (const suggestion of suggestions) {
      const key = `${suggestion.action}-${suggestion.targetThoughtId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(suggestion);
      }
    }
    
    // Sort by priority (high > medium > low)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    unique.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    
    return unique.slice(0, maxSuggestions);
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
      updatedAt: now,
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
      const sessionId = tree.metadata?.sessionId;
      const context = this.buildRichContextForGeneration(tree, parentThought, numChildren, sessionId);
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
        updatedAt: now,
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
        const sessionId = tree.metadata?.sessionId;
        const context = this.buildRichContextForGeneration(tree, thought, 1, sessionId);

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
   * Visualize a tree in the specified format (ASCII, Mermaid, DOT, PNG, or SVG)
   */
  async visualizeTree(params: VisualizeTreeParams): Promise<string> {
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
      case 'png':
      case 'svg':
        const mermaidCode = this.renderMermaidTree(tree);
        const result: RenderResult = await renderMermaid(mermaidCode, format as 'png' | 'svg');
        return JSON.stringify(result);
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

    lines.push(`Legend: ○=pending ✓=evaluated ★=selected ✗=pruned ↳=recently moved [C:creativity] [R:risk]`);
    lines.push('');

    const renderNode = (thoughtId: string, prefix: string, isLast: boolean): void => {
      const thought = tree.thoughts.get(thoughtId);
      if (!thought) return;

      const stateIcon = this.getStateIcon(thought.state);
      const label = this.formatThoughtLabel(thought, true);

      // Add moved indicator for recently moved thoughts (within last 5 minutes)
      const movedIndicator = thought.movedAt ? ' ↳' : '';

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

      lines.push(`${prefix}${isLast ? '└── ' : '├── '}${stateIcon} ${label}${movedIndicator}${badges}`);

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
      const movedSuffix = thought.movedAt ? ' ↳' : '';

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

      const nodeLabel = badges ? `${content}${verificationSuffix}${movedSuffix}${badges}` : `${content}${verificationSuffix}${movedSuffix}`;
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
