# SSE и streaming в LLM Gateway

## 1. Зачем нужен streaming

Обычный HTTP-запрос выглядит так:

```text
клиент → запрос → сервер → ждёт 10 секунд → отдаёт весь JSON целиком
```

Для LLM это плохо: модель генерирует ответ токен за токеном, и пользователь
видит пустой экран, пока не будет готов весь текст.

Streaming переворачивает схему: сервер отдаёт первые токены почти сразу, а
соединение остаётся открытым, пока ответ не закончится.

```text
клиент → POST /v1/chat/completions (stream: true)
клиент ← HTTP 200 text/event-stream
клиент ← data: {"delta":"При"}
клиент ← data: {"delta":"вет"}
клиент ← data: {"delta":"!"}
клиент ← data: [DONE]
```

## 2. Что такое SSE

**Server-Sent Events (SSE)** — это обычный HTTP-ответ, который не закрывается
сразу. Сервер пишет в него текстовые события по формату:

```text
data: первая строка
data: вторая строка

data: следующее событие

```

Правила:

- каждое поле пишется как `поле: значение`;
- события разделяются **пустой строкой** (`\n\n`);
- строки, начинающиеся с `:`, — комментарии (удобно для heartbeat);
- `data:` — полезная нагрузка;
- `event:` — необязательное имя типа события;
- `id:` — необязательный идентификатор;
- `retry:` — необязательная подсказка для переподключения.

SSE — это **односторонний** канал: сервер → клиент. Это не WebSocket.
WebSocket нужен для двустороннего обмена, а здесь достаточно обычного HTTP.

## 3. Формат OpenAI/OpenRouter

OpenAI-совместимые провайдеры отдают JSON-чанки в `data:`:

```text
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1710000000,"model":"meta-llama/llama-3.3-70b-instruct:free","choices":[{"index":0,"delta":{"role":"assistant","content":"При"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1710000001,"model":"meta-llama/llama-3.3-70b-instruct:free","choices":[{"index":0,"delta":{"content":"вет"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1710000002,"model":"meta-llama/llama-3.3-70b-instruct:free","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}

data: [DONE]

```

Важно:

- `delta.content` может отсутствовать в служебных чанках;
- `finish_reason` появляется в последнем содержательном чанке;
- `usage` может прийти только в финальном чанке;
- `[DONE]` — не JSON, а маркер конца потока;
- пустая строка после каждого `data:` обязательна.

## 4. Сервер: Fastify + `reply.raw`

Fastify умеет отдавать поток, но для полного контроля удобнее взять сырой
`ServerResponse`:

```ts
app.post('/v1/chat/completions', async (request, reply) => {
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text();
    return reply.code(502).send({ error: { message: details } });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.raw.write(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    reply.raw.write(
      `event: error\ndata: ${JSON.stringify({ message: 'upstream stream failed' })}\n\n`,
    );
  } finally {
    reply.raw.end();
  }
});
```

Этот вариант — «прозрачный прокси»: мы не меняем формат провайдера. Для MVP
этого достаточно, если клиент умеет читать OpenAI-совместимый SSE.

Если нужно нормализовать события (например, добавить `provider` или привести
Ollama к формату OpenAI), поток нужно парсить:

```ts
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split(/\r?\n\r?\n/);
  buffer = events.pop() ?? '';

  for (const event of events) {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        reply.raw.write('data: [DONE]\n\n');
        continue;
      }

      const chunk = JSON.parse(data);
      const normalized = normalizeChunk(chunk);
      reply.raw.write(`data: ${JSON.stringify(normalized)}\n\n`);
    }
  }
}
```

## 5. Клиент: `fetch` + `ReadableStream`

`EventSource` здесь не подходит: он умеет только GET, не поддерживает
`Authorization` и тело запроса. Для чата используется `fetch`:

```ts
const response = await fetch('/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${clientApiKey}`,
  },
  body: JSON.stringify({
    model: 'fast-model',
    messages: [{ role: 'user', content: 'Привет!' }],
    stream: true,
  }),
});

if (!response.ok || !response.body) {
  throw new Error(`HTTP ${response.status}`);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split(/\r?\n\r?\n/);
  buffer = events.pop() ?? '';

  for (const event of events) {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (data === '[DONE]') return;

      const chunk = JSON.parse(data);
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        appendToChat(delta);
      }
    }
  }
}
```

Ключевая идея: `reader.read()` возвращает куски байтов, а не готовые события.
Поэтому нужен буфер и разбиение по `\n\n`. Один `read()` может содержать
полсобытия, несколько событий или только начало JSON.

## 6. Fallback и ошибки при streaming

До первого токена всё просто: если провайдер упал, можно попробовать
следующего.

После первого токена — сложнее: HTTP-статус и заголовки уже отправлены,
поменять их нельзя. Поэтому есть два подхода.

### Вариант A: ждать первый чанк, потом отправлять заголовки

```text
запрос → провайдер A → ошибка → провайдер B → первый чанк → 200 SSE → поток
```

Плюс: fallback работает полностью.
Минус: клиент не получает заголовки, пока не появится первый токен.

Для курсовой это рекомендуемый вариант.

### Вариант B: сразу отправить 200 и потом сообщить об ошибке событием

```text
200 SSE → data: {"delta":"..."} → event: error → data: [DONE]
```

Плюс: заголовки уходят сразу.
Минус: fallback уже невозможен, клиент должен уметь обрабатывать `event: error`.

В любом случае нужно:

- прерывать upstream-запрос при отключении клиента;
- писать в лог `ttft_ms` (time to first token), общее время и число попыток;
- не писать в лог содержимое промптов по умолчанию;
- аккуратно закрывать поток в `finally`.

Отключение клиента:

```ts
const controller = new AbortController();

reply.raw.on('close', () => {
  controller.abort();
});

const upstream = await fetch(url, { signal: controller.signal, ... });
```

## 7. Backpressure

`reply.raw.write()` возвращает `false`, если внутренний буфер заполнен.
Для коротких чанков это редкость, но правильная реализация ждёт событие
`drain`:

```ts
function writeChunk(res: ServerResponse, chunk: string): Promise<void> {
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => res.once('drain', resolve));
}
```

Для MVP можно не усложнять, но упомянуть ограничение в README.

## 8. Heartbeat

Прокси и балансировщики могут закрыть соединение, если долго нет данных.
Раз в 15 секунд можно отправлять SSE-комментарий:

```ts
const heartbeat = setInterval(() => {
  reply.raw.write(': ping\n\n');
}, 15_000);

reply.raw.on('close', () => clearInterval(heartbeat));
```

## 9. Как проверить вручную

```sh
curl -N \
  -H "Authorization: Bearer <OPENROUTER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/llama-3.3-70b-instruct:free",
    "messages": [{"role": "user", "content": "Привет!"}],
    "stream": true
  }' \
  https://openrouter.ai/api/v1/chat/completions
```

`-N` отключает буферизацию curl. Если всё работает, текст будет появляться
постепенно, а в конце придет `data: [DONE]`.

## 10. Частые ошибки

- Забыть пустую строку после `data:` — клиент не увидит событие.
- Использовать `EventSource` для POST-запроса с телом.
- Пытаться сделать fallback после первого отправленного чанка.
- Не обрабатывать `[DONE]` и пытаться парсить его как JSON.
- Буферизовать поток на nginx без `X-Accel-Buffering: no`.
- Не прерывать upstream при закрытии вкладки клиентом.
- Считать `usage` в streaming всегда доступным: иногда его нет.
- Логировать `Authorization` и API-ключи.

## 11. Чек-лист реализации в проекте

- [ ] `POST /v1/chat/completions` принимает `stream: true`.
- [ ] Ответ имеет `Content-Type: text/event-stream`.
- [ ] Каждый чанк — валидный JSON в `data:`.
- [ ] Поток завершается `data: [DONE]`.
- [ ] Ошибка до первого чанка запускает fallback.
- [ ] Ошибка после первого чанка отправляет `event: error`.
- [ ] При отключении клиента upstream отменяется.
- [ ] В `request_logs` пишутся `ttft_ms`, `latency_ms`, `status`.
- [ ] В `request_attempts` видно, какой провайдер и ключ сработали.
- [ ] Тест проверяет, что несколько чанков приходят по порядку.
