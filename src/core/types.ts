export type MessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface UnifiedRequest {
  modelId: string; // Например, "gpt-4o" или "llama-3"
  messages: ChatMessage[];
  temperature?: number;
}

export interface UnifiedResponse {
  provider: string; // Кто реально ответил (для аналитики)
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  latencyMs: number;
}

// Главный интерфейс, который должны реализовать все провайдеры
export interface LLMProviderAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  chat(request: UnifiedRequest): Promise<UnifiedResponse>;
}