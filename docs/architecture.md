# Архитектура Unified LLM Gateway

## 1. Цели

Шлюз решает четыре задачи:

1. **Единый API.** Клиент работает с одним OpenAI-совместимым контрактом.
2. **Ротация ключей.** У провайдера может быть несколько API-ключей; шлюз
   переключается между ними, чтобы не упираться в лимиты.
3. **Fallback.** Если провайдер недоступен, запрос уходит следующему
   провайдеру из цепочки.
4. **Наблюдаемость.** Каждый запрос и каждая попытка логируются: токены,
   стоимость, latency, статус, выбранный провайдер и ключ.

## 2. Компоненты

```text
Client
  │
  ▼
HTTP layer (Fastify)
  │  аутентификация клиента, Zod-валидация, rate limit
  ▼
Router / application layer
  │  выбор стратегии, цепочка fallback, circuit breaker
  ▼
Key pool
  │  round-robin по ключам провайдера, cooldown при 429
  ▼
Adapter layer
  │  OpenAICompatibleAdapter, AnthropicAdapter, OllamaAdapter, MockAdapter
  ▼
Upstream provider
  │
  ▼
Request logger
  │  request_logs + request_attempts
  ▼
Client
```

## 3. Поток запроса

1. Клиент отправляет `POST /v1/chat/completions`.
2. Fastify проверяет `Authorization: Bearer <client_key>`.
3. Zod валидирует тело запроса.
4. Router по `model` находит alias и упорядоченный список deployments.
5. Для каждого deployment выбирается ключ из пула.
6. Adapter преобразует запрос в формат провайдера и делает HTTP-запрос.
7. При retryable-ошибке Router пробует следующий ключ или deployment.
8. Ответ нормализуется в OpenAI-совместимый формат.
9. В БД пишутся `request_logs` и `request_attempts`.
10. Клиент получает JSON или SSE-поток.

## 4. Модель маршрутизации

Нельзя жёстко привязывать логическую модель к одному провайдеру. Нужны два
уровня:

```text
models
  id              uuid
  provider_id     -> providers.id
  upstream_model  "meta-llama/llama-3.3-70b-instruct:free"
  display_name
  input_price_per_1m
  output_price_per_1m
  context_window

model_routes
  id              uuid
  alias           "fast-model"       <- это просит клиент
  model_id        -> models.id
  priority        1..N               <- порядок fallback
  weight          для weighted round-robin
  is_active
```

Пример:

```text
alias "fast-model"
  1. OpenRouter / meta-llama/llama-3.3-70b-instruct:free
  2. Groq       / llama-3.3-70b-versatile
  3. Ollama     / llama3.2
```

Клиент не знает, кто ответит. В ответе можно вернуть фактическую модель и
провайдера в метаданных.

## 5. Ошибки и fallback

| Ошибка | Действие |
|---|---|
| `400`, `422` | Не повторять, вернуть клиенту |
| `401`, `403` | Пометить ключ невалидным, попробовать следующий ключ |
| `429` | Отправить ключ в cooldown, попробовать следующий ключ |
| `5xx`, timeout, network | Попробовать следующий deployment |
| Ошибка после первого SSE-чанка | Отправить `event: error`, закрыть поток |

Нужны:

- per-attempt timeout;
- общий deadline на запрос;
- максимум попыток;
- circuit breaker на провайдера;
- запись каждой попытки в `request_attempts`.

## 6. Ротация ключей

Для MVP достаточно in-memory счётчика на провайдера:

```text
keys = [key1, key2, key3]
index = (index + 1) % keys.length
```

При `429` ключ получает `cooldown_until` и временно исключается.
При `401` ключ помечается невалидным.

Ограничение: при нескольких инстансах шлюза in-memory счётчик рассинхронизируется.
Для курсовой это допустимо, но в README нужно указать, что для production
нужен Redis или атомарное обновление в БД.

## 7. Секреты

- Ключи провайдеров шифруются AES-256-GCM.
- Мастер-ключ хранится в `ENCRYPTION_KEY`, а не в БД.
- В БД хранится `encrypted_key`, `iv`, `auth_tag` и `key_hint`.
- Ключи клиентов хранятся как HMAC/SHA-256 hash, а не в открытом виде.
- В логах Pino настраивается redaction для `authorization`, `x-api-key`,
  `cookie`.
- Admin API защищён отдельным `ADMIN_TOKEN`.
- `base_url` провайдера проверяется по allowlist, чтобы не получить SSRF.

## 8. Данные

Основные таблицы:

- `clients` — клиентские ключи и лимиты;
- `providers` — тип, `base_url`, таймауты, статус;
- `api_keys` — зашифрованные ключи, cooldown, счётчики;
- `models` — конкретные upstream-модели и цены;
- `model_routes` — alias и цепочка fallback;
- `request_logs` — итог запроса;
- `request_attempts` — каждая попытка провайдера/ключа.

Стоимость хранится в целых микро-долларах, чтобы избежать ошибок округления
float. Цены задаются за 1M токенов.

## 9. Принятые решения

| Решение | Обоснование |
|---|---|
| OpenRouter как основной провайдер | OpenAI-совместимый API, есть бесплатные модели, удобно демонстрировать fallback |
| Один `OpenAICompatibleAdapter` | OpenRouter, OpenAI, Groq и Ollama используют похожий `/chat/completions` |
| PostgreSQL в Docker | Реалистичная схема, транзакции, удобно показывать на защите |
| Drizzle ORM | Лёгкий, типизированный, без генерации тяжёлого клиента |
| React-консоль в `web/` | Наглядная демонстрация, переиспользование компонентов лабораторной |
| SSE, а не WebSocket | Односторонний поток токенов, обычный HTTP, проще проксировать |

## 10. Границы MVP

В MVP не входят:

- биллинг и реальные платежи;
- мультитенантная авторизация с ролями;
- горизонтальное масштабирование;
- tool calling и vision;
- точный подсчёт токенов для всех моделей;
- полноценный UI-конструктор промптов.

Это ограничения, которые нужно явно указать в пояснительной записке.
