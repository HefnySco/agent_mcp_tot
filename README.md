# 🌳 Tree of Thoughts (ToT) MCP Server

**Tree of Thoughts (ToT)** is a powerful reasoning framework that enables AI models to explore multiple solution paths systematically. Think of it as a decision tree for thoughts—your AI can generate different approaches, evaluate them, backtrack when stuck, and focus on the most promising paths. Perfect for complex problem-solving, strategic planning, and multi-step reasoning tasks.

Whether you're solving puzzles, planning projects, or exploring creative alternatives, ToT provides structured exploration with evaluation scores, pruning strategies, and persistent storage for tracking reasoning over time.

## ✨ Features

- **🌲 Thought Trees** - Create hierarchical thought structures with parent-child relationships
- **📊 Evaluation** - Score thoughts to guide exploration toward promising paths
- **↩️ Backtracking** - Mark thought branches as pruned and explore alternatives
- **✂️ Pruning** - Automatically remove low-scoring branches
- **🏆 Best Path Selection** - Identify and select the most promising thoughts
- **💾 Persistent Storage** - Save and load thought trees across sessions with atomic writes and error handling
- **📈 Statistics** - Track tree metrics (depth, evaluations, pruning rates)
- **🔍 Branching Strategies** - Systematic exploration using BFS, DFS, beam search, and best-first search
- **🤖 LLM Integration** - Optional LLM provider for automated thought generation with strict mode support
- **🛡️ Robust Traversal** - Iterative implementations for handling very deep trees without recursion limits
- **✅ Schema Validation** - Input validation for all tool parameters

## 🚀 Installation

```bash
npm install
npm run build
```

## ⚙️ Configuration

Add to your MCP client configuration (e.g., `mcp.json`):

```json
{
  "mcpServers": {
    "tot": {
      "command": "node",
      "args": ["/path/to/ToT-mcp/dist/index.js"],
      "env": {
        "TOT_STORAGE_PATH": "/path/to/ToT-mcp/tot-storage.json",
        "TOT_OUTPUT_DIR": "/path/to/ToT-mcp/output"
      }
    }
  }
}
```

## 🎯 Quick Start

### Basic Example

Create a tree to solve a problem:
```json
{
  "goal": "Solve the 24 game with numbers [3, 8, 8, 8]",
  "rootContent": "Start with the numbers 3, 8, 8, 8",
  "maxDepth": 5
}
```

Add child thoughts with different approaches:
```json
{
  "treeId": "tree-123",
  "parentId": "thought-456",
  "content": "Try multiplying 8 * 8 = 64, then 64 / 8 = 8, then 8 * 3 = 24"
}
```

Evaluate thoughts to guide exploration:
```json
{
  "treeId": "tree-123",
  "thoughtId": "thought-789",
  "score": 0.95,
  "reasoning": "This approach successfully reaches the target of 24"
}
```

### LLM Provider Configuration

The server supports optional LLM integration for automated thought generation. To configure an LLM provider, modify the server instantiation in `src/index.ts`:

```typescript
const llmProvider = {
  generateThoughts: async (prompt: string, count: number, context?: string): Promise<string[]> => {
    // Your LLM implementation here
    return Array.from({ length: count }, (_, i) => `Generated thought ${i + 1}`);
  }
};

const config = {
  llmProvider,
  strictLLM: false // Set to true to throw errors when LLM is not configured
};

const server = new ToTMCPServer(config);
```

**Strict Mode**: When `strictLLM` is set to `true`, the server will throw an error if `generate_children` is called without an LLM provider configured. This prevents accidental use of placeholder thoughts in production environments.

#### Using with LLM Providers

The ToT service includes example LLM provider implementations in the `examples/llm-providers/` directory:

**Mock LLM Provider** - A simple mock implementation for testing:
```typescript
import { MockLLMProvider } from './examples/llm-providers/mock-llm-provider.js';

const llmProvider = new MockLLMProvider([
  'Consider exploring the most promising path first',
  'Try a different approach by breaking down the problem',
  'Evaluate the trade-offs between different solutions'
]);

const config = { llmProvider, strictLLM: false };
const service = new ToTService('./tot-storage.json', config);
```

**Grok LLM Provider** - Example implementation using xAI's Grok API (commented by default):
```typescript
import { GrokLLMProvider } from './examples/llm-providers/grok-llm-provider.js';

const apiKey = process.env.GROK_API_KEY;
const llmProvider = new GrokLLMProvider(apiKey);

const config = { llmProvider, strictLLM: true };
const service = new ToTService('./tot-storage.json', config);
```

**Ollama LLM Provider** - Local LLM support using Ollama:
```typescript
import { OllamaLLMProvider } from './examples/llm-providers/ollama-llm-provider.js';

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama2';
const llmProvider = new OllamaLLMProvider(ollamaBaseUrl, ollamaModel);

const config = { llmProvider, strictLLM: true };
const service = new ToTService('./tot-storage.json', config);
```

To use Ollama:
1. Install and start Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama2` (or any other model)
3. Set environment variables:
   - `LLM_PROVIDER_TYPE=ollama`
   - `OLLAMA_BASE_URL=http://localhost:11434` (optional, default)
   - `OLLAMA_MODEL=llama2` (optional, default)

See `examples/llm-providers/grok-llm-provider.ts` and `examples/llm-providers/ollama-llm-provider.ts` for full implementations. Remember to never hardcode API keys - use environment variables or secure configuration management.

#### Generate and Evaluate in One Step

The `generateChildrenAndEvaluate` method combines thought generation with automatic evaluation:

```typescript
// Generate children with a default score of 50
const children = await service.generateChildrenAndEvaluate({
  treeId: 'tree-123',
  parentId: 'thought-456',
  numChildren: 3
}, 50);

// Generate children and use LLM as judge for evaluation
const childrenWithJudge = await service.generateChildrenAndEvaluate({
  treeId: 'tree-123',
  parentId: 'thought-456',
  numChildren: 3
}, undefined, true);
```

This method requires an LLM provider to be configured.

## 🛠️ Available Tools

### Tree Management

### `create_tree`
Create a new Tree of Thoughts with a root thought and goal.

**Parameters:**
- `goal` (string, required): The goal or problem this tree is solving
- `rootContent` (string, required): The content of the root thought
- `maxDepth` (number, optional): Maximum depth of the tree (default: 10)
- `metadata` (object, optional): Optional metadata for the tree

### `get_tree`
Get a tree by ID.

**Parameters:**
- `treeId` (string, required): The ID of the tree to retrieve

### `list_trees`
List all trees.

### `delete_tree`
Delete a tree by ID.

**Parameters:**
- `treeId` (string, required): The ID of the tree to delete

### Thought Operations

### `add_child`
Add a child thought to an existing thought.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `parentId` (string, required): The ID of the parent thought
- `content` (string, required): The content of the child thought
- `metadata` (object, optional): Optional metadata for the thought

### `evaluate_thought`
Evaluate a thought with a score.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `thoughtId` (string, required): The ID of the thought to evaluate
- `score` (number, required): The evaluation score (e.g., 0-1 or 0-100)
- `reasoning` (string, optional): Optional reasoning for the evaluation

### `select_thought`
Mark a thought as selected for further exploration.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `thoughtId` (string, required): The ID of the thought to select

### `backtrack`
Backtrack from a thought, marking all descendants as pruned.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `thoughtId` (string, required): The ID of the thought to backtrack from

### `prune_tree`
Prune thoughts below a certain evaluation threshold.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `threshold` (number, required): The evaluation threshold (thoughts below this will be pruned)

### Query Operations

### `get_thought`
Get a specific thought by ID.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `thoughtId` (string, required): The ID of the thought to retrieve

### `get_tree_structure`
Get the hierarchical structure of a tree.

**Parameters:**
- `treeId` (string, required): The ID of the tree

### `get_best_thoughts`
Get the best evaluated thoughts in a tree.

**Parameters:**
- `treeId` (string, required): The ID of the tree
- `limit` (number, optional): Maximum number of thoughts to return (default: 5)

### `get_tree_stats`
Get statistics about a tree.

**Parameters:**
- `treeId` (string, required): The ID of the tree

**Returns:**
- `totalThoughts`: Total number of thoughts in the tree
- `evaluatedThoughts`: Number of evaluated thoughts
- `selectedThoughts`: Number of selected thoughts
- `prunedThoughts`: Number of pruned thoughts
- `maxDepthReached`: Maximum depth reached in the tree
- `averageEvaluation`: Average evaluation score

### System Operations

### `clear_all`
Clear all trees.

### `save_state`
Manually save the current state to storage.

### `get_version`
Get the version information of this ToT MCP server.

### `explore_with_strategy`
Explore a thought tree using a systematic branching strategy.

**Parameters:**
- `treeId` (string, required): The ID of the tree to explore
- `strategy` (string, required): The branching strategy to use (`bfs`, `dfs`, `beam`, or `best_first`)
- `maxThoughts` (number, optional): Maximum number of thoughts to explore (default: 100)
- `beamWidth` (number, optional): Beam width for beam search strategy (default: 3)
- `stopCriteria` (object, optional): Optional stop criteria
  - `minEvaluation` (number): Stop when a thought reaches this evaluation score
  - `maxDepth` (number): Stop when reaching this depth
  - `targetThoughtCount` (number): Stop when exploring this many thoughts

**Returns:**
- `thoughtsExplored`: Number of thoughts explored
- `thoughtsCreated`: Number of thoughts created during exploration
- `maxDepthReached`: Maximum depth reached
- `bestThoughtId`: ID of the best thought found
- `bestEvaluation`: Evaluation score of the best thought
- `stoppedReason`: Reason why exploration stopped

## 📖 Usage Example

Here's a typical workflow for solving a problem using ToT:

1. **Create a tree** with your goal and initial thought
2. **Add child thoughts** representing different approaches
3. **Evaluate each thought** based on its promise
4. **Select the best thoughts** for further exploration
5. **Add more children** to selected thoughts
6. **Backtrack** if a path doesn't work out
7. **Prune** low-scoring branches to focus resources
8. **Review the tree structure** to understand the reasoning path

## 📊 Data Structures

### Thought
```typescript
{
  id: string;
  content: string;
  parentId: string | null;
  children: string[];
  evaluation: number | null;
  state: 'pending' | 'evaluated' | 'selected' | 'pruned';
  depth: number;
  createdAt: string;
  metadata?: Record<string, any>;
}
```

### Tree
```typescript
{
  id: string;
  rootId: string;
  thoughts: Map<string, Thought>;
  goal: string;
  createdAt: string;
  updatedAt: string;
  maxDepth: number;
  metadata?: Record<string, any>;
}
```

## 💾 Storage

Thought trees are persisted to `tot-storage.json` in JSON format. The storage mechanism uses:

- **Atomic Writes**: Data is written to a temporary file first, then renamed to prevent corruption
- **Error Handling**: Graceful recovery from corrupt files with detailed error messages
- **Schema Validation**: Loaded data is validated to ensure structural integrity
- **Graceful Degradation**: Corrupt or missing files result in an empty state rather than crashes

Logs of tool calls are stored in the `output` directory with daily rotation.

## 📄 License

MIT
