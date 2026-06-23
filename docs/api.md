# API Documentation

## ToTService

The main service class for managing Tree of Thoughts operations.

### Constructor

```typescript
constructor(storagePath: string, config?: ToTServiceConfig)
```

Creates a new ToTService instance.

**Parameters:**
- `storagePath`: Path to the JSON file for persistent storage
- `config`: Optional configuration object

### Methods

#### createTree

```typescript
createTree(params: CreateTreeParams): Tree
```

Creates a new tree with a root thought.

**Parameters:**
- `goal`: The goal or problem this tree is solving
- `rootContent`: Content of the root thought
- `maxDepth`: Optional maximum depth for the tree
- `metadata`: Optional metadata object

**Returns:** The created Tree object

#### addChildThought

```typescript
addChildThought(params: AddChildThoughtParams): Thought
```

Adds a child thought to an existing thought.

**Parameters:**
- `treeId`: ID of the tree
- `parentId`: ID of the parent thought
- `content`: Content of the new thought
- `metadata`: Optional metadata object

**Returns:** The created Thought object

#### evaluateThought

```typescript
evaluateThought(params: EvaluateThoughtParams): Thought
```

Evaluates a thought with a score.

**Parameters:**
- `treeId`: ID of the tree
- `thoughtId`: ID of the thought to evaluate
- `score`: Evaluation score (0-100)
- `reasoning`: Optional reasoning for the evaluation

**Returns:** The updated Thought object

#### verifyThought

```typescript
verifyThought(params: VerifyThoughtParams): Thought
```

Marks a thought as verified.

**Parameters:**
- `treeId`: ID of the tree
- `thoughtId`: ID of the thought to verify
- `verificationNotes`: Optional verification notes

**Returns:** The updated Thought object

#### selectThought

```typescript
selectThought(params: SelectThoughtParams): Thought
```

Selects a verified thought for further exploration.

**Parameters:**
- `treeId`: ID of the tree
- `thoughtId`: ID of the thought to select

**Returns:** The updated Thought object

#### backtrack

```typescript
backtrack(params: BacktrackParams): void
```

Backtracks from a thought, marking all descendants as pruned.

**Parameters:**
- `treeId`: ID of the tree
- `thoughtId`: ID of the thought to backtrack from

#### pruneTree

```typescript
pruneTree(params: PruneTreeParams): PruneResult
```

Prunes thoughts below a certain evaluation threshold.

**Parameters:**
- `treeId`: ID of the tree
- `threshold`: Minimum evaluation score to keep

**Returns:** PruneResult with count of pruned thoughts

#### exploreWithStrategy

```typescript
exploreWithStrategy(params: ExploreWithStrategyParams): ExploreResult
```

Explores the tree using a specific strategy.

**Parameters:**
- `treeId`: ID of the tree
- `strategy`: Strategy to use ('bfs', 'dfs', 'best_first', 'beam')
- `maxThoughts`: Maximum number of thoughts to explore
- `stopCriteria`: Optional stop criteria
- `beamWidth`: Beam width for beam search strategy

**Returns:** ExploreResult with exploration statistics

#### visualizeTree

```typescript
visualizeTree(params: VisualizeTreeParams): string
```

Generates a visualization of the tree.

**Parameters:**
- `treeId`: ID of the tree
- `format`: Visualization format ('ascii', 'mermaid', 'dot')

**Returns:** String representation of the visualization

#### generateChildren

```typescript
generateChildren(params: GenerateChildrenParams): Promise<Thought[]>
```

Generates child thoughts using the configured LLM provider.

**Parameters:**
- `treeId`: ID of the tree
- `parentId`: ID of the parent thought
- `numChildren`: Number of children to generate
- `diversityPrompt`: Optional prompt to encourage diversity

**Returns:** Array of generated Thought objects

## Types

### Tree

```typescript
interface Tree {
  id: string;
  goal: string;
  rootId: string;
  thoughts: Map<string, Thought>;
  maxDepth: number;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
```

### Thought

```typescript
interface Thought {
  id: string;
  content: string;
  parentId: string | null;
  children: string[];
  depth: number;
  state: 'pending' | 'evaluated' | 'selected' | 'pruned';
  evaluation: number | null;
  verified: boolean;
  verificationNotes: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
```

### LLMProvider

```typescript
interface LLMProvider {
  generateThoughts(prompt: string, count: number, context?: string): Promise<string[]>;
}
```

Interface for implementing custom LLM providers.
