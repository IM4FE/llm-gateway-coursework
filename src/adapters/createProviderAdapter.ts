import { GatewayError } from '../core/errors.js';
import type { LLMProviderAdapter, ProviderType } from '../core/types.js';
import {
  OpenAICompatibleAdapter,
  type FetchLike,
} from './OpenAICompatibleAdapter.js';

/**
 * Создаёт адаптер по типу провайдера.
 *
 * OpenRouter, OpenAI, Groq и Ollama используют один и тот же
 * OpenAI-совместимый протокол, поэтому им нужен один класс.
 * Anthropic и mock пока не реализованы — лучше упасть с понятной
 * ошибкой, чем молча отправить запрос не туда.
 */
export function createProviderAdapter(
  name: string,
  type: ProviderType,
  fetchImpl: FetchLike = fetch,
): LLMProviderAdapter {
  switch (type) {
    case 'openai_compatible':
    case 'ollama':
      return new OpenAICompatibleAdapter(name, fetchImpl, type);
    case 'anthropic':
    case 'mock':
      throw new GatewayError({
        code: 'internal_error',
        message: `Provider type "${type}" is not implemented yet`,
      });
  }
}
