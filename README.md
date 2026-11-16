# Unified LLM Gateway

Учебный проект: шлюз к LLM-провайдерам с единым OpenAI-совместимым API,
ротацией API-ключей, fallback-цепочками и журналом запросов.

## Стек

- Node.js 22+ (локально проверено на Node.js 24)
- TypeScript, ESM
- Fastify 5
- Zod 4
- PostgreSQL 17 в Docker
- Drizzle ORM
- Pino
- Vitest

## Быстрый старт

```sh
npm install
docker compose up -d
```

Создайте `.env` на основе `.env.example` и сгенерируйте мастер-ключ:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Полученное значение подставьте в `ENCRYPTION_KEY`. Docker Desktop должен быть
запущен, иначе `docker compose up -d` не сможет подключиться к демону.

Примените миграции:

```sh
npm run db:migrate
```

Заполните `OPENROUTER_API_KEY` в `.env` и создайте тестовые данные:

```sh
npm run db:seed
```

Скрипт идемпотентен: создаёт провайдера OpenRouter, бесплатную модель,
alias `fast-model` и зашифрованный ключ. Повторный запуск не создаёт дубликаты.

Создайте клиента шлюза и сохраните выведенный API-ключ:

```sh
npm run db:create-client -- "Postman" 60
```

Второй аргумент — лимит запросов в минуту. Ключ печатается один раз:
в базе лежит только его SHA-256-хэш.

Запуск в режиме разработки:

```sh
npm run dev
```

Проверка:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

## API

### `POST /v1/chat/completions`

Запрос требует клиентский ключ в заголовке `Authorization: Bearer ...`.
Ключ создаётся командой `npm run db:create-client` и печатается один раз.

#### curl (bash / macOS / Linux)

```sh
export CLIENT_KEY="lgw_..."

curl -sS http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $CLIENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"fast-model","messages":[{"role":"user","content":"Hello!"}]}'
```

#### curl.exe (Windows PowerShell)

```powershell
$env:CLIENT_KEY = "lgw_..."

curl.exe -sS -X POST http://localhost:3000/v1/chat/completions `
  -H "Authorization: Bearer $env:CLIENT_KEY" `
  -H "Content-Type: application/json" `
  -d '{"model":"fast-model","messages":[{"role":"user","content":"Hello!"}]}'
```

Для кириллицы в Windows PowerShell надёжнее отправить UTF-8-файл:

```powershell
$json = @'
{
  "model": "fast-model",
  "messages": [
    { "role": "user", "content": "Привет!" }
  ]
}
'@

[System.IO.File]::WriteAllText(
  (Join-Path $PWD "body.json"),
  $json,
  (New-Object System.Text.UTF8Encoding($false))
)

curl.exe -sS -X POST http://localhost:3000/v1/chat/completions `
  -H "Authorization: Bearer $env:CLIENT_KEY" `
  -H "Content-Type: application/json; charset=utf-8" `
  --data-binary "@body.json"
```

Формат запроса и ответа совместим с OpenAI Chat Completions. Поле `model` —
это alias из `model_routes`, а не имя upstream-модели.

Аутентификация устроена так:

1. Клиент присылает `Authorization: Bearer <client_key>`.
2. Шлюз считает SHA-256 от ключа.
3. Ищет активную запись в `clients` по `key_hash`.
4. Если клиента нет или он деактивирован — возвращает `401`.

Сам ключ в БД не хранится: только `key_hash` и короткий `key_prefix`.
Поэтому потерянный ключ нельзя восстановить, можно только создать нового
клиента.

### Rate limit

У каждого клиента есть `rate_limit_rpm` (по умолчанию 60). Шлюз использует
in-memory счётчик с фиксированным окном 60 секунд. Лимит проверяется после
аутентификации и до валидации тела запроса.

При превышении возвращается:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1800000000
```

```json
{
  "error": {
    "message": "Rate limit exceeded: 60 request(s) per minute",
    "type": "rate_limit_error",
    "code": "rate_limited"
  }
}
```

На успешных ответах тоже есть заголовки:

```text
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1800000000
```

`X-RateLimit-Reset` — Unix-время в секундах, когда окно сбросится.

Ограничение текущей реализации: счётчики живут в памяти процесса. Если
запустить несколько экземпляров шлюза, у каждого будет свой лимит. Для
горизонтального масштабирования счётчики нужно вынести в Redis.

### Журнал запросов

Каждый запрос, дошедший до Router, сохраняется в две таблицы:

- `request_logs` — итог запроса: клиент, alias, фактическая модель,
  провайдер, ключ, токены, latency, статус и код ошибки;
- `request_attempts` — каждая фактическая попытка Router'а: провайдер,
  ключ, HTTP-статус, ошибка и latency.

Запрос и его попытки пишутся одной транзакцией. Если вставка попыток
упадёт, запись о запросе тоже откатится: в журнале не появится запрос
без истории fallback'а.

Каждый ответ получает заголовок:

```http
X-Request-Id: 6f1c2a7e-0f6b-4a9c-9d7e-3b5a1c8e2d40
```

Это внутренний идентификатор запроса. По нему можно найти запись:

```sh
docker compose exec postgres psql -U gateway -d llm_gateway -c \
  "select request_id, requested_model, actual_model, status, error_code, latency_ms from request_logs order by created_at desc limit 5;"
```

И попытки этого запроса:

```sh
docker compose exec postgres psql -U gateway -d llm_gateway -c \
  "select a.attempt_no, a.status, a.http_status, a.error_code, a.latency_ms from request_attempts a join request_logs l on l.id = a.request_log_id where l.request_id = '6f1c2a7e-0f6b-4a9c-9d7e-3b5a1c8e2d40' order by a.attempt_no;"
```

Посмотреть `X-Request-Id` в ответе:

```sh
curl -i -sS http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $CLIENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"fast-model","messages":[{"role":"user","content":"Hello!"}]}'
```

В PowerShell:

```powershell
curl.exe -i -sS -X POST http://localhost:3000/v1/chat/completions `
  -H "Authorization: Bearer $env:CLIENT_KEY" `
  -H "Content-Type: application/json" `
  -d '{"model":"fast-model","messages":[{"role":"user","content":"Hello!"}]}'
```

Важные детали:

- `cost_micros` пока всегда `0`: расчёт стоимости появится отдельным шагом;
- запросы, отклонённые до Router (`401`, `429`, `400`), в журнал не пишутся —
  они видны в логах приложения;
- запись журнала best-effort: если БД недоступна, клиент всё равно получит
  ответ провайдера, а ошибка сохранения попадёт в лог приложения;
- `X-Request-Id` возвращается на всех ответах, включая ошибки.

### Состояние ключей в БД

Раньше cooldown и invalid-состояние жили только в памяти `KeyPool`:
после перезапуска шлюз забывал, что ключ недавно получил `429`, и снова
пробовал его первым.

Теперь `api_keys` использует поля:

- `failure_count` — счётчик ошибок ключа;
- `cooldown_until` — до какого момента ключ не выдавать;
- `last_used_at` — когда ключ последний раз участвовал в запросе;
- `is_active` — `false` после `401/403`.

При создании пула `ApiKeyRepository` читает эти поля, а `KeyPool`
восстанавливает состояние:

- `cooldown_until` в будущем → ключ сразу в `cooldown`;
- `cooldown_until` в прошлом → ключ активен;
- `failure_count` и `last_used_at` восстанавливаются как есть.

Router сообщает об изменениях через `onKeyState`:

| Событие | Что пишется в БД |
|---|---|
| успех | `failure_count = 0`, `cooldown_until = null`, `last_used_at = now` |
| `429` | `cooldown_until = now + cooldownMs`, `failure_count += 1`, `last_used_at = now` |
| `401/403` | `is_active = false`, `failure_count += 1`, `cooldown_until = null`, `last_used_at = now` |
| другая ошибка | `failure_count += 1`, `last_used_at = now` |

`failure_count += 1` выполняется атомарно в SQL, поэтому параллельные
запросы не теряют инкременты.

Запись состояния — best-effort и не ждётся в горячем пути Router'а.
Если БД недоступна, ответ клиенту не ломается, а ошибка попадает в лог.

Посмотреть состояние ключей:

```sh
docker compose exec postgres psql -U gateway -d llm_gateway -c \
  "select id, key_hint, is_active, failure_count, cooldown_until, last_used_at from api_keys order by created_at;"
```

Сбросить cooldown и счётчик ошибок вручную:

```sh
docker compose exec postgres psql -U gateway -d llm_gateway -c \
  "update api_keys set cooldown_until = null, failure_count = 0;"
```

Важно: `PoolRegistry` кэширует пулы в памяти. Состояние загружается
при первом запросе к провайдеру после старта процесса. Если поменять
ключи или их состояние в БД, нужно перезапустить шлюз (или вызвать
`pools.refresh(providerId)`, когда появится админка).

Ограничение: при одновременных success и `429` для одного ключа
возможен last-write-wins для `cooldown_until`. Для учебного проекта
это приемлемо; строгая версия потребовала бы версионирования
или отдельной таблицы событий.

Чтобы запрос дошёл до OpenRouter, в БД должны быть:

- провайдер `OpenRouter` с `base_url = https://openrouter.ai/api/v1`;
- модель с нужным `upstream_model`;
- маршрут `alias → model`;
- активный ключ в `api_keys`.

`ADMIN_TOKEN` пока не используется: он предназначен для будущей админки.

## Скрипты

| Команда | Назначение |
|---|---|
| `npm run dev` | Запуск Fastify с горячей перезагрузкой |
| `npm run build` | Компиляция `src` в `dist` |
| `npm start` | Запуск собранного приложения |
| `npm run typecheck` | Проверка типов без сборки |
| `npm test` | Юнит- и интеграционные тесты |
| `npm run db:generate` | Генерация миграции Drizzle |
| `npm run db:migrate` | Применение миграций |
| `npm run db:seed` | Заполнение БД провайдером, моделью, alias и ключом |
| `npm run db:create-client` | Создание клиента и печать его API-ключа |
| `npm run db:studio` | Drizzle Studio |

## Структура

```text
src/
├── adapters/        # адаптеры провайдеров
├── auth/            # аутентификация клиентов по Bearer-ключу
├── config/          # валидация окружения
├── core/            # доменные типы и ядро маршрутизации
├── db/              # схема Drizzle, клиент и репозитории
├── routes/          # HTTP-маршруты, резолвер и сборка deployment'ов
├── app.ts           # сборка Fastify-приложения
└── index.ts         # точка входа
web/                 # будущая demo/admin-консоль (React)
docs/                # пояснения и проектная документация
```

## OpenRouter и бесплатные модели

OpenRouter предоставляет OpenAI-совместимый endpoint:

```text
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <OPENROUTER_API_KEY>
```

Поэтому отдельный SDK не нужен: адаптер будет работать через обычный `fetch`
и настраиваемый `baseUrl`. Это позволяет использовать один и тот же
`OpenAICompatibleAdapter` для OpenRouter, OpenAI, Groq и Ollama.

Для бесплатных моделей используется суффикс `:free`, например:

```text
nvidia/nemotron-3.5-lightning:free
deepseek/deepseek-r1:free
```

Список доступных бесплатных моделей меняется, поэтому его нужно хранить в БД,
а не хардкодить в адаптере. У бесплатных моделей есть лимиты и периодическая
недоступность — для демонстрации ротации ключей и fallback это даже полезно.

## Документация

- [Как работает SSE и streaming](docs/streaming.md)
- [План и архитектурные решения](docs/architecture.md) — в следующем шаге

## Текущий статус

- [x] Инициализация TypeScript/Fastify
- [x] Валидация окружения через Zod
- [x] Docker Compose с PostgreSQL
- [x] Health/ready endpoints
- [x] Доменные контракты и модель ошибок
- [x] Схема БД и первая миграция Drizzle
- [x] OpenAI-совместимый адаптер (OpenRouter, без streaming)
- [x] Пул ключей в памяти: round-robin, cooldown, invalid-ключи
- [x] Загрузка ключей из БД и шифрование AES-256-GCM
- [x] Резолвер маршрутов из БД и кэш пулов ключей
- [x] Fallback по ключам и провайдерам
- [x] HTTP endpoint `POST /v1/chat/completions`
- [x] Seed-скрипт для провайдера, модели, alias и ключа
- [x] Аутентификация клиентов по Bearer-ключу (SHA-256 в БД)
- [x] Rate limit по клиентам (in-memory, фиксированное окно)
- [x] Журнал запросов: `request_logs` и `request_attempts`
- [x] Сохранение состояния ключей (cooldown, last_used_at) в БД
- [ ] Streaming в адаптере (SSE)
- [ ] Circuit breaker
- [ ] SSE streaming
- [ ] Расчёт стоимости запросов
- [ ] Demo/admin-консоль
