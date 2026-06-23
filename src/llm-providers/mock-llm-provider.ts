/**
 * Mock LLM Provider
 * 
 * This is a simple mock implementation of the LLMProvider interface
 * that returns predefined thoughts. Use this for testing without
 * requiring an actual LLM API key.
 */

import { LLMProvider, StructuredEvaluationResult } from '../types.js';

export class MockLLMProvider implements LLMProvider {
  private predefinedThoughts: string[];
  private lastUsageStats: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

  constructor(thoughts?: string[]) {
    this.predefinedThoughts = thoughts || [
      'Consider exploring the most promising path first',
      'Try a different approach by breaking down the problem',
      'Evaluate the trade-offs between different solutions',
      'Look for patterns or similarities to known problems',
      'Consider edge cases and potential failure modes'
    ];
  }

  async generateThoughts(prompt: string, count: number, context?: string, temperature?: number): Promise<string[]> {
    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Temperature affects which thoughts are selected (simulated behavior)
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      let index: number;
      if (temperature && temperature > 0.7) {
        // High temperature: random selection
        index = Math.floor(Math.random() * this.predefinedThoughts.length);
      } else {
        // Low temperature: sequential selection
        index = i % this.predefinedThoughts.length;
      }
      const thought = this.predefinedThoughts[index];
      result.push(thought);
    }

    // Simulate usage stats
    this.lastUsageStats = {
      promptTokens: prompt.length + (context?.length || 0),
      completionTokens: result.join('').length,
      totalTokens: prompt.length + (context?.length || 0) + result.join('').length
    };

    return result;
  }

  async generateThoughtsAdvanced(
    prompt: string,
    count: number,
    context?: string,
    temperature?: number,
    fewShotExamples?: string[]
  ): Promise<string[]> {
    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // If few-shot examples are provided, use them to influence the output
    const baseThoughts = fewShotExamples && fewShotExamples.length > 0
      ? fewShotExamples
      : this.predefinedThoughts;

    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      let index: number;
      if (temperature && temperature > 0.7) {
        index = Math.floor(Math.random() * baseThoughts.length);
      } else {
        index = i % baseThoughts.length;
      }
      result.push(baseThoughts[index]);
    }

    this.lastUsageStats = {
      promptTokens: prompt.length + (context?.length || 0) + (fewShotExamples?.join('').length || 0),
      completionTokens: result.join('').length,
      totalTokens: prompt.length + (context?.length || 0) + (fewShotExamples?.join('').length || 0) + result.join('').length
    };

    return result;
  }

  async evaluateThoughtStructured(thought: string, goal: string, context?: string): Promise<StructuredEvaluationResult> {
    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Generate pseudo-random but deterministic scores based on thought content
    const hash = thought.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const creativity = (hash % 40) + 50; // 50-90
    const risk = (hash % 30) + 20; // 20-50
    const feasibility = (hash % 30) + 60; // 60-90
    const goalAlignment = (hash % 25) + 65; // 65-90
    const overallScore = Math.round((creativity * 0.3 + feasibility * 0.3 + goalAlignment * 0.4));

    const result: StructuredEvaluationResult = {
      overallScore,
      reasoning: `This thought shows ${creativity > 70 ? 'high' : 'moderate'} creativity with ${risk < 35 ? 'low' : 'moderate'} risk.`,
      criteriaScores: {
        creativity,
        risk,
        feasibility,
        goal_alignment: goalAlignment
      },
      creativity,
      risk
    };

    this.lastUsageStats = {
      promptTokens: thought.length + goal.length + (context?.length || 0),
      completionTokens: JSON.stringify(result).length,
      totalTokens: thought.length + goal.length + (context?.length || 0) + JSON.stringify(result).length
    };

    return result;
  }

  getLastUsageStats(): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    return this.lastUsageStats;
  }

  async selfReflect(thought: string, feedback: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Reflected thought: ${thought} (based on feedback: ${feedback})`;
  }

  async refineThought(thought: string, goal: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Refined: ${thought} - aligned with goal: ${goal}`;
  }

  async synthesizeThoughts(thoughts: string[], goal: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Synthesized thought combining ${thoughts.length} ideas for goal: ${goal}`;
  }
}

// Example usage:
/*
import { ToTService } from '../totService.js';
import { MockLLMProvider } from './llm-providers/mock-llm-provider.js';

const llmProvider = new MockLLMProvider();
const config = {
  llmProvider,
  strictLLM: false
};

const service = new ToTService('./tot-storage.json', config);
*/
