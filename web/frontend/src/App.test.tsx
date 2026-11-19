import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from './auth/AdminAuthProvider'
import { routes } from './router/routes'

import type { RequestLog, RequestLogDetails } from './data/types'

const sampleRequest: RequestLog = {
  id: 'log-1',
  requestId: '7f4c2b91-6d20-4f4f-a6e2-1b7c9d0e1001',
  requestedModel: 'fast-model',
  actualModel: 'nvidia/nemotron-3.5-lightning:free',
  clientName: 'Postman',
  providerName: 'OpenRouter',
  status: 'success',
  errorCode: null,
  costMicros: 0,
  promptTokens: 42,
  completionTokens: 118,
  totalTokens: 160,
  latencyMs: 418,
  ttftMs: null,
  isStream: false,
  createdAt: '2026-11-17T18:41:12.000Z',
}

const sampleDetails: RequestLogDetails = {
  ...sampleRequest,
  attempts: [
    {
      attemptNo: 1,
      providerName: 'OpenRouter',
      status: 'success',
      httpStatus: 200,
      errorCode: null,
      latencyMs: 418,
      createdAt: '2026-11-17T18:41:12.000Z',
    },
  ],
}

function jsonResponse(body: unknown, status = 200): {
  ok: boolean
  status: number
  json: () => Promise<unknown>
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function stubApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/requests') {
        return jsonResponse({ requests: [sampleRequest] })
      }

      if (url === `/api/requests/${sampleRequest.requestId}`) {
        return jsonResponse(sampleDetails)
      }

      return jsonResponse({ error: { message: 'Not found' } }, 404)
    }),
  )
}

function renderApp(initialEntries: string[] = ['/']): void {
  const router = createMemoryRouter(routes, { initialEntries })

  render(
    <AdminAuthProvider>
      <RouterProvider router={router} />
    </AdminAuthProvider>,
  )
}

describe('App routing', () => {
  beforeEach(() => {
    sessionStorage.clear()
    stubApi()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the dashboard', async () => {
    renderApp()

    expect(
      screen.getByRole('heading', { name: 'Панель управления' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Последние запросы')).toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: sampleRequest.requestedModel }),
    ).toBeInTheDocument()
  })

  it('navigates to providers and opens a provider detail page', async () => {
    const user = userEvent.setup()

    renderApp()

    await user.click(screen.getByRole('link', { name: 'Провайдеры' }))

    expect(
      screen.getByRole('heading', { name: 'Провайдеры' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'OpenRouter' }))

    expect(
      screen.getByRole('heading', { name: 'OpenRouter' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Подключение')).toBeInTheDocument()
  })

  it('opens the models page', () => {
    renderApp(['/models'])

    expect(
      screen.getByRole('heading', { name: 'Маршруты моделей' }),
    ).toBeInTheDocument()
  })

  it('opens the requests journal with data from the API', async () => {
    renderApp(['/requests'])

    expect(screen.getByRole('heading', { name: 'Запросы' })).toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: sampleRequest.requestId }),
    ).toBeInTheDocument()
  })

  it('opens the sandbox', () => {
    renderApp(['/playground'])

    expect(screen.getByRole('heading', { name: 'Песочница' })).toBeInTheDocument()
    expect(screen.getByLabelText('Alias модели')).toBeInTheDocument()
  })

  it('opens request details by request id', async () => {
    renderApp([`/requests/${sampleRequest.requestId}`])

    expect(
      await screen.findByRole('heading', {
        name: `Запрос ${sampleRequest.requestId}`,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Попытки')).toBeInTheDocument()
  })

  it('redirects an unauthenticated user from settings to login and signs in', async () => {
    const user = userEvent.setup()

    renderApp(['/settings'])

    expect(
      screen.getByRole('heading', { name: 'Вход в админ-консоль' }),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText('Admin token'), 'secret-token')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(
      screen.getByRole('heading', { name: 'Настройки' }),
    ).toBeInTheDocument()
    expect(sessionStorage.getItem('llm-gateway-admin-token')).toBe('secret-token')
  })

  it('shows the not found page for unknown routes', () => {
    renderApp(['/missing'])

    expect(
      screen.getByRole('heading', { name: 'Страница не найдена' }),
    ).toBeInTheDocument()
  })
})
