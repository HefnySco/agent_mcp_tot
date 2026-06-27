export interface Thought {
  id: string;
  content: string;
  parentId: string | null;
  children: string[];
  evaluation: number | null;
  
  // Multi-criteria evaluation fields
  creativity?: number | null;
  risk?: number | null;
  criteriaScores?: Record<string, number>;
  
  state: 'pending' | 'evaluated' | 'selected' | 'pruned';
  depth: number;
  createdAt: string;
  updatedAt: string;
  verified?: boolean;
  verificationNotes?: string;
  movedAt?: string;
  metadata?: Record<string, any>;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export interface Tree {
  id: string;
  rootId: string;
  thoughts: Map<string, Thought>;
  goal: string;
  createdAt: string;
  updatedAt: string;
  maxDepth: number;
  metadata?: Record<string, any>;
  usageStats?: UsageStats;
}

export interface CreateTreeParams {
  goal: string;
  rootContent: string;
  maxDepth?: number;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export type ThoughtCriteria = 'creativity' | 'risk' | 'feasibility' | 'goal_alignment' | 'novelty' | 'risk_vs_reward';

export interface AddChildParams {
  treeId: string;
  parentId: string;
  content: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface EvaluateParams {
  treeId: string;
  thoughtId: string;
  score: number;
  creativity?: number;
  risk?: number;
  criteriaScores?: Record<string, number>;
  reasoning?: string;
}

export interface SelectParams {
  treeId: string;
  thoughtId: string;
}

export interface VerifyParams {
  treeId: string;
  thoughtId: string;
  verificationNotes?: string;
}

export interface BacktrackParams {
  treeId: string;
  thoughtId: string;
}

export interface PruneParams {
  treeId: string;
  threshold: number;
  riskThreshold?: number;
}

export interface TreeStats {
  totalThoughts: number;
  evaluatedThoughts: number;
  selectedThoughts: number;
  prunedThoughts: number;
  maxDepthReached: number;
  averageEvaluation: number;
  averageCreativity?: number;
  averageRisk?: number;
  usageStats?: UsageStats;
}

export type BranchingStrategyType = 'bfs' | 'dfs' | 'beam' | 'best_first';

export type SortByType = 'evaluation' | 'creativity' | 'risk' | 'combined';

export interface ExploreWithStrategyParams {
  treeId: string;
  strategy: BranchingStrategyType;
  maxThoughts?: number;
  beamWidth?: number;
  stopCriteria?: {
    minEvaluation?: number;
    maxDepth?: number;
    targetThoughtCount?: number;
  };
}

export interface ExplorationResult {
  thoughtsExplored: number;
  thoughtsCreated: number; // Always 0 - exploreWithStrategy only traverses existing thoughts
  maxDepthReached: number;
  bestThoughtId: string | null;
  bestEvaluation: number | null;
  stoppedReason: string;
}

export interface ProposeAndEvaluateParams {
  treeId: string;
  parentId: string;
  content: string;
  score: number;
  creativity?: number;
  risk?: number;
  criteriaScores?: Record<string, number>;
  reasoning?: string;
  metadata?: Record<string, any>;
}

export interface GenerateChildrenParams {
  treeId: string;
  parentId: string;
  numChildren: number;
  diversityPrompt?: string;
  metadata?: Record<string, any>;
}

export interface GeneratedChild {
  thoughtId: string;
  content: string;
  depth: number;
}

// Custom error classes
export class ToTError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToTError';
  }
}

export class TreeNotFoundError extends ToTError {
  constructor(treeId: string) {
    super(`Tree not found: ${treeId}`);
    this.name = 'TreeNotFoundError';
  }
}

export class ThoughtNotFoundError extends ToTError {
  constructor(treeId: string, thoughtId: string) {
    super(`Thought not found: ${thoughtId} in tree: ${treeId}`);
    this.name = 'ThoughtNotFoundError';
  }
}

export class MaxDepthReachedError extends ToTError {
  constructor(treeId: string, currentDepth: number, maxDepth: number) {
    super(`Maximum depth reached for tree ${treeId}: ${currentDepth}/${maxDepth}`);
    this.name = 'MaxDepthReachedError';
  }
}

export class InvalidEvaluationError extends ToTError {
  constructor(score: number) {
    super(`Invalid evaluation score: ${score}. Must be between 0 and 100.`);
    this.name = 'InvalidEvaluationError';
  }
}

export class InvalidStrategyError extends ToTError {
  constructor(strategy: string) {
    super(`Invalid strategy: ${strategy}. Must be one of: bfs, dfs, beam, best_first`);
    this.name = 'InvalidStrategyError';
  }
}

export class UnverifiedThoughtError extends ToTError {
  constructor(thoughtId: string) {
    super(`Cannot select unverified thought: ${thoughtId}. Use verify_thought first to confirm findings before selecting.`);
    this.name = 'UnverifiedThoughtError';
  }
}

export class CycleDetectionError extends ToTError {
  constructor(subtreeRootId: string, newParentId: string) {
    super(`Cannot move subtree: new parent ${newParentId} is a descendant of subtree root ${subtreeRootId}, which would create a cycle.`);
    this.name = 'CycleDetectionError';
  }
}

// LLM integration interface
export interface StructuredEvaluationResult {
  overallScore: number;
  reasoning: string;
  criteriaScores: Record<string, number>;
  creativity?: number;
  risk?: number;
}

export interface LLMProvider {
  generateThoughts(prompt: string, count: number, context?: string, temperature?: number): Promise<string[]>;
  generateThoughtsAdvanced?(prompt: string, count: number, context?: string, temperature?: number, fewShotExamples?: string[]): Promise<string[]>;
  evaluateThoughtStructured?(thought: string, goal: string, context?: string): Promise<StructuredEvaluationResult>;
  getLastUsageStats?(): { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  selfReflect?(thought: string, feedback: string): Promise<string>;
  refineThought?(thought: string, goal: string): Promise<string>;
  synthesizeThoughts?(thoughts: string[], goal: string): Promise<string>;
}

export interface ToTServiceConfig {
  llmProvider?: LLMProvider | null;
  strictLLM?: boolean; // If true, throw error when LLM provider not configured instead of using placeholder
  temperatureConfig?: {
    minTemperature?: number; // Minimum temperature (default: 0.1)
    maxTemperature?: number; // Maximum temperature (default: 1.0)
    initialTemperature?: number; // Starting temperature (default: 0.8)
    decayRate?: number; // How fast temperature decreases per depth level (default: 0.1)
  };
}

// Strategy execution types for type-safe traversal implementations
export interface StopCriteria {
  minEvaluation?: number;
  maxDepth?: number;
  targetThoughtCount?: number;
}

export interface StrategyCallback {
  (explored: number, depth: number, bestId: string | null, bestEval: number | null, reason: string): void;
}

export interface TraversalStrategyConfig<TData = string, TItem = string> {
  initialData: TData;
  getNext: (data: TData) => TItem | undefined;
  addChildren: (data: TData, children: string[], tree: Tree) => void;
  hasMore: (data: TData) => boolean;
  shouldSkipVisited: boolean;
  extractId?: (item: TItem) => string;
}

export interface TraversalStrategy {
  execute(
    tree: Tree,
    maxThoughts: number,
    stopCriteria: StopCriteria,
    callback: StrategyCallback
  ): void;
}

export type VisualizationFormat = 'ascii' | 'mermaid' | 'dot';

export interface VisualizeTreeParams {
  treeId: string;
  format?: VisualizationFormat;
}

export interface NextActionSuggestion {
  action: string;
  targetThoughtId?: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface MoveSubtreeParams {
  treeId: string;
  subtreeRootId: string;
  newParentId: string;
  dryRun?: boolean;
}

export interface MoveSubtreeResult {
  valid: boolean;
  errors: string[];
  movedCount: number;
  newSubtreeRootDepth: number;
  warnings: string[];
  affectedThoughtIds: string[];
}
