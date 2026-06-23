/**
 * Mock LLM Provider Example
 * 
 * This is a simple mock implementation of the LLMProvider interface
 * that returns predefined thoughts. Use this as a starting point for
 * testing or as a template for implementing your own LLM provider.
 */

import { LLMProvider } from '../../src/types.js';

export class MockLLMProvider implements LLMProvider {
  private predefinedThoughts: string[];

  constructor(thoughts?: string[]) {
    this.predefinedThoughts = thoughts || [
      'Consider exploring the most promising path first',
      'Try a different approach by breaking down the problem',
      'Evaluate the trade-offs between different solutions',
      'Look for patterns or similarities to known problems',
      'Consider edge cases and potential failure modes'
    ];
  }

  async generateThoughts(prompt: string, count: number, context?: string): Promise<string[]> {
    // Simulate async delay (optional)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Return thoughts from the predefined list, cycling if needed
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      const thought = this.predefinedThoughts[i % this.predefinedThoughts.length];
      result.push(thought);
    }

    return result;
  }
}

// Example usage:
/*
import { ToTService } from '../src/totService.js';
import { MockLLMProvider } from './examples/llm-providers/mock-llm-provider.js';

const llmProvider = new MockLLMProvider();
const config = {
  llmProvider,
  strictLLM: false
};

const service = new ToTService('./tot-storage.json', config);
*/
