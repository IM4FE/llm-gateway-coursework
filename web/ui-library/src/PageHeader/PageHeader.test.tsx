import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders eyebrow, title, description and actions', () => {
    render(
      <PageHeader
        actions={<button type="button">Создать</button>}
        description="Краткое описание страницы"
        eyebrow="Раздел"
        title="Провайдеры"
      />,
    )

    expect(screen.getByText('Раздел')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Провайдеры' })).toBeInTheDocument()
    expect(screen.getByText('Краткое описание страницы')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать' })).toBeInTheDocument()
  })

  it('renders only the required title', () => {
    const { container } = render(<PageHeader title="Модели" />)

    expect(screen.getByRole('heading', { name: 'Модели' })).toBeInTheDocument()
    expect(container.querySelector('p')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
