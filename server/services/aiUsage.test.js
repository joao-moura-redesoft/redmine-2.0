import { describe, it, expect } from 'vitest';
import aiUsage from './aiUsageStore.js';

describe('aiUsage.usageFrom', () => {
  it('normaliza o formato da Anthropic', () => {
    expect(aiUsage.usageFrom({ usage: { input_tokens: 10, output_tokens: 5 } })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('normaliza o formato OpenAI/Gemini/local', () => {
    expect(aiUsage.usageFrom({ usage: { prompt_tokens: 20, completion_tokens: 7 } })).toEqual({
      inputTokens: 20,
      outputTokens: 7,
    });
  });

  it('devolve objeto vazio sem usage', () => {
    expect(aiUsage.usageFrom(null)).toEqual({});
    expect(aiUsage.usageFrom({})).toEqual({});
  });
});
