/**
 * Ollama LLM Provider
 * 
 * Implementation of the LLMProvider interface using Ollama for local LLM inference.
 * 
 * Ollama allows running large language models locally. This provider connects to
 * a local Ollama instance (default: http://localhost:11434) to generate thoughts.
 * 
 * Requirements:
 * - Ollama must be installed and running locally
 * - Models must be pulled using `ollama pull <model-name>`
 * 
 * Common models: llama2, mistral, codellama, phi, gemma, etc.
 */

import { LLMProvider, StructuredEvaluationResult } from '../types.js';

export class OllamaLLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private lastUsageStats: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama2') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
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
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: temperature ?? 0.7,
            num_predict: 500
          },
          num_predict: 500
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Store usage stats (Ollama provides eval_count and prompt_eval_count)
      if (data.eval_count !== undefined || data.prompt_eval_count !== undefined) {
        this.lastUsageStats = {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };
      }
      
      // Ollama returns a single response, so we need to generate multiple thoughts
      // We'll make multiple requests or parse the response if it contains multiple thoughts
      const thoughts: string[] = [];
      
      if (count === 1) {
        thoughts.push(data.response.trim());
      } else {
        // For multiple thoughts, we'll split the response by newlines or make multiple calls
        const lines = data.response.split('\n').filter((line: string) => line.trim().length > 0);
        
        if (lines.length >= count) {
          thoughts.push(...lines.slice(0, count).map((line: string) => line.trim()));
        } else {
          // If not enough lines, make additional calls
          thoughts.push(...lines.map((line: string) => line.trim()));
          for (let i = thoughts.length; i < count; i++) {
            const additionalResponse = await this.generateThoughts(prompt, 1, context, temperature);
            thoughts.push(additionalResponse[0]);
          }
        }
      }

      return thoughts;
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      throw new Error(`Failed to connect to Ollama at ${this.baseUrl}. Make sure Ollama is running and the model is pulled.`);
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
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: temperature ?? 0.7,
            num_predict: 500
          },
          num_predict: 500
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.eval_count !== undefined || data.prompt_eval_count !== undefined) {
        this.lastUsageStats = {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };
      }
      
      const thoughts: string[] = [];
      const lines = data.response.split('\n').filter((line: string) => line.trim().length > 0);
      
      if (lines.length >= count) {
        thoughts.push(...lines.slice(0, count).map((line: string) => line.trim()));
      } else {
        thoughts.push(...lines.map((line: string) => line.trim()));
        for (let i = thoughts.length; i < count; i++) {
          const additionalResponse = await this.generateThoughtsAdvanced(prompt, 1, context, temperature, fewShotExamples);
          thoughts.push(additionalResponse[0]);
        }
      }

      return thoughts;
    } catch (error) {
      console.error('Error calling Ollama API for advanced generation:', error);
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

Ensure all scores are integers between 0 and 100. Respond ONLY with the JSON object, no other text.`;

    const userPrompt = context
      ? `Goal: "${goal}"\n\nContext: ${context}\n\nThought to evaluate:\n"${thought}"`
      : `Goal: "${goal}"\n\nThought to evaluate:\n"${thought}"`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 500
          },
          num_predict: 500
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.eval_count !== undefined || data.prompt_eval_count !== undefined) {
        this.lastUsageStats = {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };
      }

      // Parse JSON from the response (may have extra text)
      const content = data.response.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('Failed to extract JSON from Ollama response');
      }

      const result = JSON.parse(jsonMatch[0]) as StructuredEvaluationResult;

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
      console.error('Error calling Ollama API for structured evaluation:', error);
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
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 300
          },
          num_predict: 300
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.eval_count !== undefined || data.prompt_eval_count !== undefined) {
        this.lastUsageStats = {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };
      }

      return data.response.trim();
    } catch (error) {
      console.error('Error calling Ollama API for self-reflection:', error);
      throw error;
    }
  }

  async refineThought(thought: string, goal: string): Promise<string> {
    const systemPrompt = 'You are a helpful AI assistant that refines thoughts to better align with goals.';
    const userPrompt = `Goal: "${goal}"\n\nOriginal thought: "${thought}"\n\nProvide a refined version of the thought that better aligns with the goal.`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.6,
            num_predict: 300
          },
          num_predict: 300
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.eval_count !== undefined || data.prompt_eval_count !== undefined) {
        this.lastUsageStats = {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };
      }

      return data.response.trim();
    } catch (error) {
      console.error('Error calling Ollama API for thought refinement:', error);
      throw error;
    }
  }

  async synthesizeThoughts(thoughts: string[], goal: string): Promise<string> {
    const systemPrompt = 'You are a helpful AI assistant that synthesizes multiple thoughts into a single, comprehensive thought.';
    const thoughtsList = thoughts.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const userPrompt = `Goal: "${goal}"\n\nThoughts to synthesize:\n${thoughtsList}\n\nProvide a single synthesized thought that combines the best aspects of all the given thoughts.`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.5,
            num_predict: 400
          },
          num_predict: 400
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.eval_count !== undefined || data.prompt_eval_count !== undefined) {
        this.lastUsageStats = {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };
      }

      return data.response.trim();
    } catch (error) {
      console.error('Error calling Ollama API for thought synthesis:', error);
      throw error;
    }
  }

  /**
   * List available models from the Ollama instance
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error('Error listing Ollama models:', error);
      throw error;
    }
  }

  /**
   * Check if the Ollama service is available
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Example usage:
/*
import { ToTService } from '../totService.js';
import { OllamaLLMProvider } from './llm-providers/ollama-llm-provider.js';

// Configure Ollama provider
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama2';

const llmProvider = new OllamaLLMProvider(ollamaBaseUrl, ollamaModel);

// Check connection before using
const isConnected = await llmProvider.checkConnection();
if (!isConnected) {
  console.error('Cannot connect to Ollama. Make sure Ollama is running.');
  process.exit(1);
}

// List available models
const models = await llmProvider.listModels();
console.log('Available models:', models);

const config = {
  llmProvider,
  strictLLM: true
};

const service = new ToTService('./tot-storage.json', config);
*/
