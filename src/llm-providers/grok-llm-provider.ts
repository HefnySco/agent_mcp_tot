/**
 * Grok LLM Provider
 * 
 * Implementation of the LLMProvider interface using the xAI Grok API.
 * 
 * IMPORTANT: Never hardcode API keys in your code. Use environment variables
 * or a secure configuration management system.
 */

import { LLMProvider, StructuredEvaluationResult } from '../types.js';

export class GrokLLMProvider implements LLMProvider {
  private apiKey: string;
  private apiUrl: string;
  private model: string;
  private lastUsageStats: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

  constructor(apiKey: string, model: string = 'grok-3') {
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.x.ai/v1/chat/completions';
    this.model = model;
  }

  async generateThoughts(prompt: string, count: number, context?: string, temperature?: number): Promise<string[]> {
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
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: temperature ?? 0.7,
          max_tokens: 500,
          n: count
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Store usage stats
      if (data.usage) {
        this.lastUsageStats = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }
      
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

  async generateThoughtsAdvanced(
    prompt: string, 
    count: number, 
    context?: string, 
    temperature?: number, 
    fewShotExamples?: string[]
  ): Promise<string[]> {
    let systemPrompt = `You are a helpful AI assistant that generates diverse thoughts for problem-solving.
Generate ${count} distinct thoughts based on the user's prompt and context.
Each thought should be concise and actionable.`;

    if (fewShotExamples && fewShotExamples.length > 0) {
      systemPrompt += '\n\nHere are some examples of good thoughts:\n';
      fewShotExamples.forEach((example, i) => {
        systemPrompt += `${i + 1}. ${example}\n`;
      });
    }

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
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: temperature ?? 0.7,
          max_tokens: 500,
          n: count
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Store usage stats
      if (data.usage) {
        this.lastUsageStats = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }
      
      const thoughts = data.choices
        .map((choice: any) => choice.message.content.trim())
        .filter((thought: string) => thought.length > 0);

      return thoughts;
    } catch (error) {
      console.error('Error calling Grok API:', error);
      throw error;
    }
  }

  async evaluateThoughtStructured(thought: string, goal: string, context?: string): Promise<StructuredEvaluationResult> {
    const systemPrompt = `You are an expert evaluator in a Tree of Thoughts reasoning system.
Evaluate the given thought based on the goal and provide a structured JSON response.

Your response must be a valid JSON object with the following fields:
- overallScore: A number between 0 and 100 representing the overall quality of the thought
- reasoning: A 1-2 sentence explanation of your evaluation
- criteriaScores: An object with numeric scores (0-100) for the following criteria:
  * creativity: How creative or novel the thought is
  * risk: The level of risk or uncertainty (higher = more risky)
  * feasibility: How feasible or practical the thought is
  * goal_alignment: How well the thought aligns with the goal
- creativity: The creativity score (also included in criteriaScores for convenience)
- risk: The risk score (also included in criteriaScores for convenience)

Ensure all scores are integers between 0 and 100.`;

    const userPrompt = context
      ? `Goal: "${goal}"\n\nContext: ${context}\n\nThought to evaluate:\n"${thought}"`
      : `Goal: "${goal}"\n\nThought to evaluate:\n"${thought}"`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Store usage stats
      if (data.usage) {
        this.lastUsageStats = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }

      const content = data.choices[0].message.content;
      const result = JSON.parse(content) as StructuredEvaluationResult;

      // Validate and normalize scores
      result.overallScore = Math.min(100, Math.max(0, Math.round(result.overallScore)));
      
      if (result.creativity !== undefined) {
        result.creativity = Math.min(100, Math.max(0, Math.round(result.creativity)));
      }
      if (result.risk !== undefined) {
        result.risk = Math.min(100, Math.max(0, Math.round(result.risk)));
      }

      // Ensure criteriaScores has creativity and risk
      if (!result.criteriaScores) {
        result.criteriaScores = {};
      }
      if (result.creativity !== undefined) {
        result.criteriaScores.creativity = result.creativity;
      }
      if (result.risk !== undefined) {
        result.criteriaScores.risk = result.risk;
      }

      // Normalize all criteria scores
      for (const key in result.criteriaScores) {
        result.criteriaScores[key] = Math.min(100, Math.max(0, Math.round(result.criteriaScores[key])));
      }

      return result;
    } catch (error) {
      console.error('Error calling Grok API for structured evaluation:', error);
      throw error;
    }
  }

  getLastUsageStats(): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    return this.lastUsageStats;
  }

  async selfReflect(thought: string, feedback: string): Promise<string> {
    const systemPrompt = 'You are a thoughtful AI assistant that reflects on feedback and improves thoughts.';
    const userPrompt = `Original thought: "${thought}"\n\nFeedback: ${feedback}\n\nProvide an improved version of the thought based on the feedback.`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 300
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.usage) {
        this.lastUsageStats = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }

      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling Grok API for self-reflection:', error);
      throw error;
    }
  }

  async refineThought(thought: string, goal: string): Promise<string> {
    const systemPrompt = 'You are a helpful AI assistant that refines thoughts to better align with goals.';
    const userPrompt = `Goal: "${goal}"\n\nOriginal thought: "${thought}"\n\nProvide a refined version of the thought that better aligns with the goal.`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.6,
          max_tokens: 300
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.usage) {
        this.lastUsageStats = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }

      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling Grok API for thought refinement:', error);
      throw error;
    }
  }

  async synthesizeThoughts(thoughts: string[], goal: string): Promise<string> {
    const systemPrompt = 'You are a helpful AI assistant that synthesizes multiple thoughts into a single, comprehensive thought.';
    const thoughtsList = thoughts.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const userPrompt = `Goal: "${goal}"\n\nThoughts to synthesize:\n${thoughtsList}\n\nProvide a single synthesized thought that combines the best aspects of all the given thoughts.`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5,
          max_tokens: 400
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.usage) {
        this.lastUsageStats = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }

      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling Grok API for thought synthesis:', error);
      throw error;
    }
  }
}

// Example usage:
/*
import { ToTService } from '../totService.js';
import { GrokLLMProvider } from './llm-providers/grok-llm-provider.js';

// Get API key from environment variable
const apiKey = process.env.GROK_API_KEY;

if (!apiKey) {
  throw new Error('GROK_API_KEY environment variable is not set');
}

const llmProvider = new GrokLLMProvider(apiKey, 'grok-3');
const config = {
  llmProvider,
  strictLLM: true
};

const service = new ToTService('./tot-storage.json', config);
*/
