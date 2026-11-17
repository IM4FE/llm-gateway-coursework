# Архитектура проекта Unified LLM Gateway

Документ описывает структуру курсового проекта, используемые библиотеки,
состав компонентов и структуру роутинга клиентского приложения.

## 1. Назначение проекта

Unified LLM Gateway — учебный шлюз к LLM-провайдерам с единым
OpenAI-совместимым API. Шлюз принимает запросы клиентов, выбирает
провайдера и API-ключ, выполняет fallback при ошибках, считает стоимость
и сохраняет журнал запросов.

Проект состоит из трёх самостоятельных пакетов:

1. **Backend** — Fastify-приложение в корне репозитория.
2. **Frontend** — React + MUI-приложение `web/frontend`.
3. **UI library** — библиотека общих компонентов `web/ui-library`
   (обёртки над MUI).

Такое разделение позволяет переиспользовать визуальные компоненты,
независимо тестировать библиотеку и развивать backend без изменений
в клиентском коде.

## 2. Структура репозитория

```text
llm-gateway-coursework/
├── src/                         # backend: Fastify + TypeScript
│   ├── adapters/                # OpenAI-совместимый адаптер
│   ├── auth/                    # аутентификация клиентов по Bearer-ключу
│   ├── config/                  # env-валидация через Zod
│   ├── core/                    # Router, KeyPool, ошибки, стоимость
│   ├── db/                      # Drizzle-схема и репозитории
│   ├── routes/                  # HTTP-маршруты Fastify
│   ├── app.ts                   # сборка Fastify-приложения
│   └── index.ts                 # точка входа backend
├── drizzle/                     # SQL-миграции
├── docs/                        # внутренняя документация backend
├── web/
│   ├── frontend/                # основное React + MUI-приложение
│   │   ├── src/
│   │   │   ├── auth/            # контекст админ-сессии
│   │   │   ├── components/      # AppLayout, SidebarNav, RequireAdmin
│   │   │   ├── data/            # типы и mock-данные
│   │   │   ├── lib/             # форматирование
│   │   │   ├── pages/           # страницы приложения
│   │   │   ├── router/          # конфигурация маршрутов
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── theme.ts         # тёмная тема MUI
│   │   ├── index.html
│   │   ├── eslint.config.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── vitest.config.ts
│   └── ui-library/              # библиотека общих компонентов
│       ├── src/
│       │   ├── Button/
│       │   ├── Card/
│       │   ├── EmptyState/
│       │   ├── PageHeader/
│       │   ├── StatCard/
│       │   ├── StatusBadge/
│       │   ├── index.ts
│       │   └── setupTests.ts
│       ├── eslint.config.js
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── vitest.config.ts
├── architecture.md              # этот документ
├── mvp.md                       # границы MVP и use case
├── README.md                    # описание и инструкция запуска
└── docker-compose.yml           # PostgreSQL
```

## 3. Проекты и их назначение

### 3.1 Backend (`/`)

**Назначение:** единый OpenAI-совместимый API, ротация ключей, fallback,
rate limiting, журналирование и расчёт стоимости.

**Ключевые папки и файлы:**

| Путь | Назначение |
|---|---|
| `src/app.ts` | Сборка Fastify, регистрация маршрутов и error handler |
| `src/index.ts` | Загрузка env, подключение к БД, запуск сервера |
| `src/config/env.ts` | Валидация переменных окружения через Zod |
| `src/core/Router.ts` | Выбор deployment'а, retry и fallback |
| `src/core/KeyPool.ts` | Round-robin ключей, cooldown, circuit breaker |
| `src/core/cost.ts` | Расчёт стоимости в micro-USD |
| `src/core/errors.ts` | `GatewayError` и классификация ошибок |
| `src/adapters/` | `OpenAICompatibleAdapter` для OpenRouter/Groq/Ollama |
| `src/auth/` | Проверка клиентского Bearer-ключа по SHA-256 |
| `src/db/schema.ts` | Drizzle-схема PostgreSQL |
| `src/db/*Repository.ts` | Доступ к провайдерам, ключам, маршрутам и логам |
| `src/routes/chatCompletions.ts` | `POST /v1/chat/completions`, JSON и SSE |

### 3.2 Frontend (`web/frontend`)

**Назначение:** демонстрационная и административная консоль шлюза.
Приложение показывает состояние провайдеров, маршрутов, ключей и
журнала запросов, а также содержит playground для проверки API.

**Ключевые папки и файлы:**

| Путь | Назначение |
|---|---|
| `src/main.tsx` | Точка входа React: `ThemeProvider`, `CssBaseline`, монтирование в `#root` |
| `src/theme.ts` | Тёмная тема MUI: палитра, типографика, скругления, overrides |
| `src/App.tsx` | `AdminAuthProvider` + `RouterProvider` |
| `src/router/routes.tsx` | Декларативная конфигурация всех маршрутов |
| `src/components/AppLayout/` | Каркас на `Drawer` + `AppBar`: sidebar, topbar, `Outlet` |
| `src/components/SidebarNav/` | Навигация на `ListItemButton` + `NavLink` с active-состоянием |
| `src/components/RequireAdmin/` | Защита маршрутов, redirect на `/login` |
| `src/auth/` | Контекст админ-сессии и `sessionStorage` |
| `src/pages/` | Страницы приложения |
| `src/data/` | Типы и mock-данные для каркаса |
| `src/lib/format.ts` | Форматирование дат, micro-USD и статусов |

Стилей в CSS-файлах нет: вся вёрстка описана пропом `sx` и темой MUI,
поэтому глобальный `src/styles/global.css` больше не нужен.

**Компоненты frontend:**

| Компонент | Назначение |
|---|---|
| `AppLayout` | Каркас на MUI `Drawer`/`AppBar` с боковой навигацией |
| `SidebarNav` | Список навигационных ссылок на `ListItemButton` |
| `RequireAdmin` | Проверка админ-сессии и redirect на логин |
| `DashboardPage` | Сводка: провайдеры, маршруты, запросы, стоимость |
| `ProvidersPage` | Список провайдеров |
| `ProviderDetailsPage` | Детали провайдера по `:providerId` |
| `ModelsPage` | Alias-маршруты и upstream-модели |
| `RequestsPage` | Журнал запросов |
| `RequestDetailsPage` | Попытки и стоимость запроса по `:requestId` |
| `PlaygroundPage` | Отправка реального запроса через Vite proxy |
| `SettingsPage` | Защищённый раздел админ-настроек |
| `LoginPage` | Демонстрационный вход в админ-сессию |
| `NotFoundPage` | Страница 404 |

### 3.3 UI library (`web/ui-library`)

**Назначение:** независимая библиотека переиспользуемых React-компонентов.
Собирается в ESM-пакет `@llm-gateway/ui` с типами.

Компоненты библиотеки — не самописные элементы с CSS-модулями, а тонкие
обёртки над [`MUI`](https://mui.com/material-ui/). Библиотека задаёт
семантические варианты (`variant="danger"`, `tone="warning"`) и
маппит их на `@mui/material`, поэтому приложение получает единый
дизайн-язык и доступность MUI «из коробки».

**Структура:**

```text
src/
├── Button/          # Button.tsx, Button.test.tsx
├── Card/            # Card.tsx, Card.test.tsx
├── EmptyState/      # EmptyState.tsx, EmptyState.test.tsx
├── PageHeader/      # PageHeader.tsx, PageHeader.test.tsx
├── StatCard/        # StatCard.tsx, StatCard.test.tsx
├── StatusBadge/     # StatusBadge.tsx, StatusBadge.test.tsx
├── index.ts         # публичные экспорты
└── setupTests.ts    # jest-dom + cleanup
```

**Компоненты библиотеки:**

| Компонент | База MUI | Назначение | Основные props |
|---|---|---|---|
| `Button` | `Button` + `CircularProgress` | Кнопка с вариантами и состоянием загрузки | `variant`, `size`, `loading`, `fullWidth` |
| `Card` | `Card`, `CardHeader`, `CardContent` | Панель с заголовком, описанием и действиями | `title`, `description`, `actions`, `tone` |
| `StatusBadge` | `Chip` | Компактный статус с цветовой индикацией | `tone`, `dot`, `children` |
| `PageHeader` | `Stack`, `Typography` | Заголовок страницы с eyebrow и actions | `eyebrow`, `title`, `description`, `actions` |
| `StatCard` | `Paper`, `Stack` | KPI-карточка | `label`, `value`, `hint`, `tone`, `icon` |
| `EmptyState` | `Paper`, `Typography` | Пустое состояние с действием | `title`, `description`, `action` |

Внешний вид обёрток задаётся пропом `sx`, поэтому отдельных
CSS-модулей и экспорта `./style.css` у пакета нет.

## 4. Используемые библиотеки

### Backend

| Библиотека | Версия | Назначение |
|---|---|---|
| `fastify` | 5.12.5 | HTTP-сервер и роутинг |
| `zod` | 4.6.5 | Валидация env и тел запросов |
| `drizzle-orm` | 0.45.4 | Типизированный ORM для PostgreSQL |
| `postgres` | 4.0.0 | Драйвер PostgreSQL |
| `pino` | 10.4.0 | Структурное логирование |
| `dotenv` | 18.0.5 | Загрузка `.env` |
| `typescript` | 7.0.2 | Компилятор TypeScript |
| `tsx` | 4.23.15 | Запуск TypeScript в dev-режиме |
| `vitest` | 5.1.0 | Юнит- и интеграционные тесты |
| `drizzle-kit` | 0.31.11 | Генерация и применение миграций |

### Frontend

| Библиотека | Версия | Назначение |
|---|---|---|
| `react` | 19.3.1 | UI-библиотека |
| `react-dom` | 19.3.1 | Рендеринг в DOM |
| `react-router-dom` | 7.18.5 | Маршрутизация, `NavLink`, `Outlet`, параметры |
| `@mui/material` | 7.3.11 | Компоненты Material UI: layout, таблицы, формы, тема |
| `@mui/icons-material` | 7.3.11 | Иконки для sidebar и действий |
| `@emotion/react` | 11.14.0 | Движок стилей MUI (peer) |
| `@emotion/styled` | 11.14.1 | Styled-API MUI (peer) |
| `@llm-gateway/ui` | 0.1.0 | Локальная библиотека общих компонентов |
| `vite` | 8.3.8 | Dev-сервер и production-сборка |
| `@vitejs/plugin-react` | 6.3.0 | React-плагин для Vite |
| `typescript` | 5.9.3 | Строгая типизация |
| `vitest` | 5.1.0 | Тесты |
| `@vitest/coverage-v8` | 5.1.0 | Coverage-отчёт |
| `jsdom` | 31.0.1 | DOM-окружение для тестов |
| `@testing-library/react` | 16.3.3 | Рендеринг и запросы к DOM |
| `@testing-library/jest-dom` | 7.0.1 | DOM-матчеры |
| `@testing-library/user-event` | 14.6.12 | Пользовательские события |
| `eslint` | 9.39.5 | Линтинг |
| `typescript-eslint` | 8.73.0 | TypeScript-правила ESLint |
| `eslint-plugin-react` | 7.37.5 | React-правила |
| `eslint-plugin-react-hooks` | 7.1.1 | Правила хуков |
| `eslint-plugin-react-refresh` | 0.5.8 | Проверка Fast Refresh |
| `eslint-plugin-import` | 2.32.0 | Порядок импортов |
| `globals` | 17.14.0 | Глобальные переменные окружений |

### UI library

| Библиотека | Версия | Назначение |
|---|---|---|
| `react` / `react-dom` | 19.3.1 | Peer-зависимости и dev-окружение |
| `@mui/material` | 7.3.11 | Peer-зависимость: база всех компонентов-обёрток |
| `@emotion/react` | 11.14.0 | Peer-зависимость MUI |
| `@emotion/styled` | 11.14.1 | Peer-зависимость MUI |
| `vite` | 8.3.8 | Сборка библиотеки в ESM |
| `vite-plugin-dts` | 5.1.2 | Генерация `.d.ts` |
| `typescript` | 5.9.3 | Типизация |
| `vitest` | 5.1.0 | Тесты компонентов |
| `@vitest/coverage-v8` | 5.1.0 | Coverage с порогом 70% |
| `jsdom` | 31.0.1 | DOM-окружение |
| `@testing-library/react` | 16.3.3 | Тестирование компонентов |
| `@testing-library/jest-dom` | 7.0.1 | DOM-матчеры |
| `@testing-library/user-event` | 14.6.12 | События пользователя |
| `eslint` + плагины | 9.39.5 / 8.73.0 | Линтинг |

## 5. Структура роутинга

Роутинг построен на `react-router-dom` v7. Корневой маршрут `/`
использует `AppLayout` с `Outlet`, поэтому все страницы наследуют
sidebar и topbar.

| Путь | Страница | Вложенность | Параметры | Защита |
|---|---|---|---|---|
| `/` | `DashboardPage` | дочерний `index` маршрут `AppLayout` | — | нет |
| `/providers` | `ProvidersPage` | дочерний `AppLayout` | — | нет |
| `/providers/:providerId` | `ProviderDetailsPage` | дочерний `AppLayout` | `providerId` | нет |
| `/models` | `ModelsPage` | дочерний `AppLayout` | — | нет |
| `/requests` | `RequestsPage` | дочерний `AppLayout` | — | нет |
| `/requests/:requestId` | `RequestDetailsPage` | дочерний `AppLayout` | `requestId` | нет |
| `/playground` | `PlaygroundPage` | дочерний `AppLayout` | — | нет |
| `/settings` | `SettingsPage` | дочерний `AppLayout` + `RequireAdmin` | — | да |
| `/login` | `LoginPage` | дочерний `AppLayout` | query `redirect` | нет |
| `*` | `NotFoundPage` | дочерний `AppLayout` | — | нет |

**Защищённый маршрут.** `/settings` обёрнут в `RequireAdmin`. Если
админ-сессия отсутствует, пользователь перенаправляется на
`/login?redirect=%2Fsettings`. После входа `LoginPage` возвращает его
на исходный путь.

**Параметризованные страницы.** `/providers/:providerId` и
`/requests/:requestId` читают параметры через `useParams`. Если объект
не найден, показывается `EmptyState` со ссылкой назад.

## 6. Использование UI library и MUI во frontend

Frontend импортирует компоненты по имени пакета:

```tsx
import { Card, PageHeader, StatCard, StatusBadge } from '@llm-gateway/ui'
```

Отдельный CSS-файл подключать не нужно: обёртки библиотеки стилизуются
пропом `sx` и берут тему из `ThemeProvider`.

`@llm-gateway/ui` подключён как локальная зависимость
`"file:../ui-library"`. Перед `dev`, `build` и `test` frontend
автоматически собирает библиотеку (`predev`, `prebuild`, `pretest`),
поэтому `dist` библиотеки всегда актуален.

MUI, Emotion и React объявлены в библиотеке как `peerDependencies` и
вынесены в `build.rollupOptions.external`. Дополнительно frontend
использует `resolve.dedupe`, поэтому в приложении остаётся ровно одна
копия React и одна копия MUI — иначе хуки падают с
`Cannot read properties of null (reading 'useContext')`.

Тема приложения живёт в `src/theme.ts` и включает MUI в `main.tsx`:

```tsx
<ThemeProvider theme={theme}>
  <CssBaseline />
  <App />
</ThemeProvider>
```

Тема задаёт тёмную палитру, скругления, типографику и overrides для
`MuiPaper`/`MuiCssBaseline`. Поверх неё приложение использует MUI
напрямую: `Drawer` и `AppBar` в `AppLayout`, `Table` на страницах
списков, `TextField`/`MenuItem` в playground и логине, `Alert` для
пояснений.

Пример использования на странице:

```tsx
<PageHeader
  eyebrow="Providers"
  title="Провайдеры"
  description="Подключения к OpenAI-совместимым провайдерам"
/>

<Card title="Список провайдеров">
  <StatusBadge tone="success">active</StatusBadge>
</Card>
```

Компоненты библиотеки используются на всех страницах: `PageHeader`,
`Card`, `StatCard`, `StatusBadge`, `Button`, `EmptyState`. Это
обеспечивает единый визуальный язык и доказывает реальное
переиспользование библиотеки.

## 7. Команды проекта

### Backend

```sh
npm run dev
npm run build
npm run test
npm run typecheck
```

### Frontend

```sh
cd web/frontend
npm install
npm run dev        # http://localhost:5173
npm run build
npm run lint
npm run lint:fix
npm run test
npm run test:coverage
```

### UI library

```sh
cd web/ui-library
npm install
npm run dev        # vite build --watch
npm run build
npm run lint
npm run lint:fix
npm run test
npm run test:coverage
```

## 8. Нефункциональные требования

- Все пакеты имеют `"type": "module"` и используют ES-импорты.
- Исходный код написан на TypeScript в strict-режиме.
- Запрещены `any`, `require`, `module.exports` и `var`.
- ESLint настроен на 2 пробела, запрет `;`, запрет лишних пустых строк,
  порядок импортов и правила React Hooks.
- `npm run lint` проходит без предупреждений и ошибок в обоих
  frontend-проектах.
- UI library покрыта тестами; coverage компонентов не ниже 70% по
  statements, branches, functions и lines.
- `node_modules`, `dist` и `coverage` игнорируются git.

## 9. Ограничения текущего каркаса

- Провайдеры, ключи и журнал на страницах — mock-данные.
- Admin API для CRUD ещё не реализован.
- Админ-сессия хранится в `sessionStorage` и не проверяется backend.
- Playground использует Vite proxy `/v1` → `http://localhost:3000`.
- Графики, WebSocket-обновления и полноценная аналитика не входят в MVP.
