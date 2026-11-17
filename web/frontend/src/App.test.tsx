import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { AdminAuthProvider } from './auth/AdminAuthProvider'
import { requests } from './data/mockData'
import { routes } from './router/routes'

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
  })

  it('renders the dashboard', () => {
    renderApp()

    expect(
      screen.getByRole('heading', { name: 'Панель управления' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Последние запросы')).toBeInTheDocument()
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

  it('opens the requests journal', () => {
    const request = requests[0]

    if (request === undefined) {
      throw new Error('Mock request is missing')
    }

    renderApp(['/requests'])

    expect(screen.getByRole('heading', { name: 'Запросы' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: request.requestId })).toBeInTheDocument()
  })

  it('opens the playground', () => {
    renderApp(['/playground'])

    expect(screen.getByRole('heading', { name: 'Playground' })).toBeInTheDocument()
    expect(screen.getByLabelText('Alias модели')).toBeInTheDocument()
  })

  it('opens request details by route parameter', () => {
    const request = requests[0]

    if (request === undefined) {
      throw new Error('Mock request is missing')
    }

    renderApp([`/requests/${request.id}`])

    expect(
      screen.getByRole('heading', { name: `Запрос ${request.requestId}` }),
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
