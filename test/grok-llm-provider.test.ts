import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GrokLLMProvider } from '../src/llm-providers/grok-llm-provider.js';

describe('GrokLLMProvider', () => {
  describe('evaluateThoughtStructured', () => {
    it('should parse valid structured JSON response', async () => {
      // Mock fetch to return a valid structured JSON response
      const mockFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  overallScore: 85,
                  reasoning: 'This thought addresses the core problem effectively.',
                  creativity: 75,
                  risk: 30,
                  criteriaScores: {
                    creativity: 75,
                    risk: 30,
                    feasibility: 90,
                    goal_alignment: 85
                  }
                })
              }
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          })
        } as Response;
      };

      global.fetch = mockFetch as any;

      const provider = new GrokLLMProvider('test-api-key');
      const result = await provider.evaluateThoughtStructured(
        'Test thought',
        'Test goal'
      );

      assert.strictEqual(result.overallScore, 85);
      assert.strictEqual(result.reasoning, 'This thought addresses the core problem effectively.');
      assert.strictEqual(result.creativity, 75);
      assert.strictEqual(result.risk, 30);
      assert.deepStrictEqual(result.criteriaScores, {
        creativity: 75,
        risk: 30,
        feasibility: 90,
        goal_alignment: 85
      });
    });

    it('should normalize out-of-range scores', async () => {
      const mockFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  overallScore: 150,
                  reasoning: 'Test',
                  creativity: -10,
                  risk: 200,
                  criteriaScores: {
                    creativity: -10,
                    risk: 200,
                    feasibility: 50
                  }
                })
              }
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          })
        } as Response;
      };

      global.fetch = mockFetch as any;

      const provider = new GrokLLMProvider('test-api-key');
      const result = await provider.evaluateThoughtStructured(
        'Test thought',
        'Test goal'
      );

      assert.strictEqual(result.overallScore, 100);
      assert.strictEqual(result.creativity, 0);
      assert.strictEqual(result.risk, 100);
      assert.strictEqual(result.criteriaScores.creativity, 0);
      assert.strictEqual(result.criteriaScores.risk, 100);
      assert.strictEqual(result.criteriaScores.feasibility, 50);
    });

    it('should handle missing criteriaScores', async () => {
      const mockFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  overallScore: 80,
                  reasoning: 'Test',
                  creativity: 70,
                  risk: 25
                })
              }
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          })
        } as Response;
      };

      global.fetch = mockFetch as any;

      const provider = new GrokLLMProvider('test-api-key');
      const result = await provider.evaluateThoughtStructured(
        'Test thought',
        'Test goal'
      );

      assert.strictEqual(result.overallScore, 80);
      assert.strictEqual(result.creativity, 70);
      assert.strictEqual(result.risk, 25);
      assert.ok(result.criteriaScores);
      assert.strictEqual(result.criteriaScores.creativity, 70);
      assert.strictEqual(result.criteriaScores.risk, 25);
    });
  });

  describe('getLastUsageStats', () => {
    it('should return usage stats after API call', async () => {
      const mockFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: 'Test thought'
              }
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          })
        } as Response;
      };

      global.fetch = mockFetch as any;

      const provider = new GrokLLMProvider('test-api-key');
      await provider.generateThoughts('Test prompt', 1);

      const stats = provider.getLastUsageStats();
      assert.ok(stats);
      assert.strictEqual(stats.promptTokens, 100);
      assert.strictEqual(stats.completionTokens, 50);
      assert.strictEqual(stats.totalTokens, 150);
    });

    it('should return null before any API call', () => {
      const provider = new GrokLLMProvider('test-api-key');
      const stats = provider.getLastUsageStats();
      assert.strictEqual(stats, null);
    });
  });
});
