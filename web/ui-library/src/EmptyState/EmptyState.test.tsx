import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        action={<button type="button">Создать</button>}
        description="Добавьте первый маршрут"
        title="Пока пусто"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Пока пусто' })).toBeInTheDocument()
    expect(screen.getByText('Добавьте первый маршрут')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument()
  })

  it('renders only the required title', () => {
    render(<EmptyState title="Нет данных" />)

    expect(screen.getByRole('heading', { name: 'Нет данных' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('Добавьте первый маршрут')).toBeNull()
  })
})
