import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatCard } from './StatCard'
import styles from './StatCard.module.css'

describe('StatCard', () => {
  it('renders label, value, hint and icon', () => {
    render(
      <StatCard
        hint="За последние 24 часа"
        icon="↗"
        label="Запросы"
        tone="success"
        value={128}
      />,
    )

    expect(screen.getByText('Запросы')).toBeInTheDocument()
    expect(screen.getByText('128')).toBeInTheDocument()
    expect(screen.getByText('За последние 24 часа')).toBeInTheDocument()
    expect(screen.getByText('↗')).toBeInTheDocument()
  })

  it('omits optional hint and icon and applies the requested tone', () => {
    const { container } = render(<StatCard label="Ошибки" tone="danger" value="2%" />)

    const card = container.firstElementChild

    expect(card).toHaveClass(styles.danger!)
    expect(screen.queryByText('За последние 24 часа')).toBeNull()
    expect(screen.queryByText('↗')).toBeNull()
  })
})
