import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlaygroundPage } from './PlaygroundPage'

function jsonResponse(body: unknown, status = 200): {
  ok: boolean
  status: number
  text: () => Promise<string>
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

describe('PlaygroundPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the request form', () => {
    render(<PlaygroundPage />)

    expect(screen.getByRole('heading', { name: 'Песочница' })).toBeInTheDocument()
    expect(screen.getByLabelText('Клиентский ключ')).toBeInTheDocument()
    expect(screen.getByLabelText('Сообщение')).toBeInTheDocument()
  })

  it('requires a client key before sending', async () => {
    const user = userEvent.setup()

    render(<PlaygroundPage />)

    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(screen.getByText('Введите клиентский ключ, созданный командой npm run db:create-client.')).toBeInTheDocument()
  })

  it('renders a successful gateway answer', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: 'pong' } }], provider: 'LocalMock' }),
      )

    vi.stubGlobal('fetch', fetchMock)
    render(<PlaygroundPage />)

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(await screen.findByText('pong')).toBeInTheDocument()
    expect(screen.getByText('LocalMock')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders a gateway error message from the API payload', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'All providers failed' } }, 502)),
    )
    render(<PlaygroundPage />)

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
    render(<PlaygroundPage />)

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
    render(<PlaygroundPage />)

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
    render(<PlaygroundPage />)

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(
      await screen.findByText(
        'Не удалось соединиться со шлюзом. Проверьте, что backend запущен на http://localhost:3000.',
      ),
    ).toBeInTheDocument()
  })
})
