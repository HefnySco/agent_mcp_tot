/**
 * Grok LLM Provider Example
 * 
 * This is an example implementation of the LLMProvider interface using
 * the xAI Grok API.
 * 
 * IMPORTANT: Never hardcode API keys in your code. Use environment variables
 * or a secure configuration management system.
 */

import { LLMProvider } from '../../src/types.js';

export class GrokLLMProvider implements LLMProvider {
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.x.ai/v1/chat/completions';
  }

  async generateThoughts(prompt: string, count: number, context?: string): Promise<string[]> {
    const systemPrompt = `You are a helpful AI assistant that generates diverse thoughts for problem-solving.
Generate ${count} distinct thoughts based on the user's prompt and context.
Each thought should be concise and actionable.`;

    const userPrompt = context 
      ? `Context: ${context}\n\nPrompt: ${prompt}`
      : prompt;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-beta', // or the latest Grok model
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 500,
          n: count
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Extract thoughts from the response
      const thoughts = data.choices
        .map((choice: any) => choice.message.content.trim())
        .filter((thought: string) => thought.length > 0);

      return thoughts;
    } catch (error) {
      console.error('Error calling Grok API:', error);
      throw error;
    }
  }
}

// Example usage:
/*
import { ToTService } from '../src/totService.js';
import { GrokLLMProvider } from './examples/llm-providers/grok-llm-provider.js';

// Get API key from environment variable
const apiKey = process.env.GROK_API_KEY;

if (!apiKey) {
  throw new Error('GROK_API_KEY environment variable is not set');
}

const llmProvider = new GrokLLMProvider(apiKey);
const config = {
  llmProvider,
  strictLLM: true // Set to true to ensure LLM is always used
};

const service = new ToTService('./tot-storage.json', config);
*/
