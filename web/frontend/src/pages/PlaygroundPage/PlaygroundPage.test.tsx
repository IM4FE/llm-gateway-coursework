import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlaygroundPage } from './PlaygroundPage'

describe('PlaygroundPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the request form', () => {
    render(<PlaygroundPage />)

    expect(screen.getByRole('heading', { name: 'Playground' })).toBeInTheDocument()
    expect(screen.getByLabelText('Клиентский ключ')).toBeInTheDocument()
    expect(screen.getByLabelText('Сообщение')).toBeInTheDocument()
  })

  it('requires a client key before sending', async () => {
    const user = userEvent.setup()

    render(<PlaygroundPage />)

    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Введите клиентский ключ')
  })

  it('renders a successful gateway answer', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'pong' } }],
        provider: 'LocalMock',
      }),
    })

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

  it('renders a gateway error', async () => {
    const user = userEvent.setup()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: { message: 'All providers failed' } }),
      }),
    )
    render(<PlaygroundPage />)

    await user.type(screen.getByLabelText('Клиентский ключ'), 'lgw_test')
    await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('All providers failed')
  })
})
