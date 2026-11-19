import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlaygroundPage } from './PlaygroundPage'

function renderPlayground(): void {
  render(
    <MemoryRouter>
      <PlaygroundPage />
    </MemoryRouter>,
  )
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): {
  ok: boolean
  status: number
  headers: Headers
  text: () => Promise<string>
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  }
}

describe('PlaygroundPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the request form', () => {
    renderPlayground()

    expect(screen.getByRole('heading', { name: 'Песочница' })).toBeInTheDocument()
    expect(screen.getByLabelText('Клиентский ключ')).toBeInTheDocument()
    expect(screen.getByLabelText('Сообщение')).toBeInTheDocument()
  })

  it('requires a client key before sending', async () => {
    const user = userEvent.setup()

    renderPlayground()

    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(screen.getByText('Введите клиентский ключ, созданный командой npm run db:create-client.')).toBeInTheDocument()
  })

  it('renders a successful gateway answer', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { choices: [{ message: { content: 'pong' } }], provider: 'LocalMock' },
          200,
          { 'X-Request-Id': 'req-test-1' },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)
    renderPlayground()

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(await screen.findByText('pong')).toBeInTheDocument()
    expect(screen.getByText('LocalMock')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'req-test-1' })).toHaveAttribute(
      'href',
      '/requests/req-test-1',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body: unknown = JSON.parse(String(request.body))

    expect(body).toEqual({
      model: 'fast-model',
      messages: [
        {
          role: 'system',
          content:
            'Отвечай на русском языке, если пользователь не попросил ответить на другом языке.',
        },
        { role: 'user', content: 'Объясни в двух предложениях, что делает circuit breaker в LLM-шлюзе.' },
      ],
    })
  })

  it('renders a gateway error message from the API payload', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'All providers failed' } }, 502)),
    )
    renderPlayground()

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(await screen.findByText('All providers failed')).toBeInTheDocument()
  })

  it('explains an empty response instead of failing on JSON parsing', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }),
    )
    renderPlayground()

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(
      await screen.findByText(
        'Шлюз не вернул тело ответа (HTTP 500). Проверьте, что backend запущен на http://localhost:3000.',
      ),
    ).toBeInTheDocument()
  })

  it('explains a non-JSON response from the proxy', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '<html>Bad gateway</html>',
      }),
    )
    renderPlayground()

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(
      await screen.findByText(
        'Шлюз ответил HTTP 502, но тело ответа не JSON. Проверьте, что backend запущен на http://localhost:3000.',
      ),
    ).toBeInTheDocument()
  })

  it('explains a network failure', async () => {
    const user = userEvent.setup()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderPlayground()

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(
      await screen.findByText(
        'Не удалось соединиться со шлюзом. Проверьте, что backend запущен на http://localhost:3000.',
      ),
    ).toBeInTheDocument()
  })
})
