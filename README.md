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

Запуск в режиме разработки:

```sh
npm run dev
```

Проверка:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

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
| `npm run db:studio` | Drizzle Studio |

## Структура

```text
src/
├── adapters/        # адаптеры провайдеров
├── config/          # валидация окружения
├── core/            # доменные типы и ядро маршрутизации
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
meta-llama/llama-3.3-70b-instruct:free
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
- [ ] Загрузка ключей из БД (`api_keys`) и шифрование
- [ ] Streaming в адаптере (SSE)
- [ ] Fallback и circuit breaker
- [ ] SSE streaming
- [ ] Журнал запросов и стоимость
- [ ] Demo/admin-консоль
