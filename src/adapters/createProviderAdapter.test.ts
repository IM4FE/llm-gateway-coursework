import { describe, expect, it } from 'vitest';

import { GatewayError } from '../core/errors.js';
import { OpenAICompatibleAdapter } from './OpenAICompatibleAdapter.js';
import { createProviderAdapter } from './createProviderAdapter.js';

describe('createProviderAdapter', () => {
  it('creates an OpenAI-compatible adapter', () => {
    const adapter = createProviderAdapter('OpenRouter', 'openai_compatible');

    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(adapter.name).toBe('OpenRouter');
    expect(adapter.type).toBe('openai_compatible');
  });

  it('creates an OpenAI-compatible adapter for Ollama', () => {
    const adapter = createProviderAdapter('Ollama', 'ollama');

    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(adapter.type).toBe('ollama');
  });

  it.each(['anthropic', 'mock'] as const)(
    'rejects the not-yet-implemented provider type %s',
    (type) => {
      expect(() => createProviderAdapter('Provider', type)).toThrow(
        GatewayError,
      );
      expect(() => createProviderAdapter('Provider', type)).toThrow(
        `Provider type "${type}" is not implemented yet`,
      );
    },
  );
});
