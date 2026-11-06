export const PROVIDER_TYPES = [
  'openai_compatible',
  'anthropic',
  'ollama',
  'mock',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'error'
  | 'unknown';

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Параметры, которые не зависят от конкретного провайдера.
 */
export interface CompletionParams {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
}

/**
 * Запрос клиента к шлюзу. `model` — логический alias,
 * например "fast-model", а не имя модели у провайдера.
 */
export interface ChatRequest extends CompletionParams {
  model: string;
  stream?: boolean;
}

/**
 * Запрос, который получает адаптер после выбора deployment.
 * Здесь уже указана конкретная upstream-модель.
 */
export interface ProviderChatRequest extends CompletionParams {
  upstreamModel: string;
}

/**
 * Ответ адаптера в нормализованном виде.
 * Router добавит к нему requestedModel.
 */
export interface ProviderChatResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  finishReason: FinishReason;
  usage: ChatUsage;
  latencyMs: number;
  ttftMs?: number;
}

/**
 * Итоговый ответ шлюза клиенту.
 */
export interface ChatResponse extends ProviderChatResponse {
  requestedModel: string;
}

export type ChatStreamChunk =
  | {
      type: 'delta';
      content: string;
    }
  | {
      type: 'done';
      finishReason: FinishReason;
      usage?: ChatUsage;
    };

export interface ChatOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Единый интерфейс адаптера провайдера.
 *
 * Адаптер не знает про пул ключей, fallback и БД: этим занимается Router.
 * Его задача — преобразовать запрос, сделать HTTP-вызов и нормализовать ответ.
 */
export interface LLMProviderAdapter {
  readonly name: string;
  readonly type: ProviderType;
  chat(
    request: ProviderChatRequest,
    options: ChatOptions,
  ): Promise<ProviderChatResponse>;
  chatStream(
    request: ProviderChatRequest,
    options: ChatOptions,
  ): AsyncIterable<ChatStreamChunk>;
}
