# Architecture

## Overview

ToT-mcp is a Model Context Protocol (MCP) server that implements the Tree of Thoughts (ToT) framework for structured reasoning and decision tree exploration.

## Components

### Core Service (`totService.ts`)

The `ToTService` class is the heart of the system, managing:

- **Tree Management**: Creation, retrieval, and deletion of thought trees
- **Thought Operations**: Adding, evaluating, verifying, and selecting thoughts
- **Exploration Strategies**: BFS, DFS, best-first, and beam search algorithms
- **Persistence**: Atomic writes to JSON storage for data integrity
- **LLM Integration**: Pluggable LLM provider interface for AI-powered thought generation

### MCP Server (`index.ts`)

The MCP server exposes ToT functionality as tools:

- **Tree Operations**: create_tree, get_tree, delete_tree, list_trees
- **Thought Operations**: add_child, evaluate_thought, verify_thought, select_thought
- **Tree Manipulation**: backtrack, prune_tree, get_tree_stats
- **Exploration**: explore_with_strategy, generate_children, generate_children_and_evaluate
- **Visualization**: visualize_tree, get_tree_structure
- **Persistence**: save_state, load_state

### Type Definitions (`types.ts`)

Defines all TypeScript interfaces and types:

- Core data structures (Tree, Thought)
- Parameter interfaces for all operations
- Custom error classes
- LLM provider interface

### LLM Providers (`llm-providers/`)

Example implementations of the LLMProvider interface:

- **grok-llm-provider.ts**: Integration with xAI Grok API
- **mock-llm-provider.ts**: Mock provider for testing

## Data Flow

```
MCP Client → MCP Server → ToTService → Storage (JSON)
                    ↓
               LLM Provider (optional)
```

## Storage

The service uses a JSON file for persistent storage with:

- **Atomic Writes**: Uses temporary file + rename to prevent corruption
- **Schema Validation**: Validates loaded data structure
- **Error Recovery**: Gracefully handles corrupt storage files

## Exploration Strategies

### BFS (Breadth-First Search)
Explores all thoughts at current depth before moving deeper. Good for finding shallow solutions.

### DFS (Depth-First Search)
Explores as deep as possible along each branch before backtracking. Good for finding deep solutions.

### Best-First Search
Explores thoughts with highest evaluation scores first. Requires thoughts to be evaluated.

### Beam Search
Maintains a fixed-size beam of best thoughts at each level. Balances breadth and depth.

## State Machine

Thoughts progress through states:

```
pending → evaluated → verified → selected
   ↓         ↓
 pruned   pruned
```

- **pending**: Newly created thought
- **evaluated**: Has an evaluation score
- **verified**: Marked as valid for selection
- **selected**: Chosen for further exploration
- **pruned**: Discarded from consideration

## Error Handling

Custom error classes provide specific error types:

- `TreeNotFoundError`: Tree doesn't exist
- `ThoughtNotFoundError`: Thought doesn't exist
- `InvalidTreeStateError`: Invalid state transition
- `ValidationError`: Invalid input parameters
