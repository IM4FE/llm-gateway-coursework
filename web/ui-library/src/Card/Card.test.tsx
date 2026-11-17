import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card } from './Card'
import styles from './Card.module.css'

describe('Card', () => {
  it('renders a header with title, description and actions', () => {
    render(
      <Card
        actions={<button type="button">Действие</button>}
        description="Описание карточки"
        title="Заголовок"
      >
        Содержимое
      </Card>,
    )

    expect(screen.getByRole('heading', { name: 'Заголовок' })).toBeInTheDocument()
    expect(screen.getByText('Описание карточки')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Действие' })).toBeInTheDocument()
    expect(screen.getByText('Содержимое')).toBeInTheDocument()
  })

  it('omits the header when no header props are provided', () => {
    const { container } = render(<Card>Только контент</Card>)

    expect(container.querySelector('header')).toBeNull()
    expect(screen.getByText('Только контент')).toBeInTheDocument()
  })

  it('supports the muted tone and custom class name', () => {
    const { container } = render(
      <Card className="custom" tone="muted">
        Контент
      </Card>,
    )

    const card = container.firstElementChild

    expect(card).toHaveClass(styles.card!)
    expect(card).toHaveClass(styles.muted!)
    expect(card).toHaveClass('custom')
  })
})
