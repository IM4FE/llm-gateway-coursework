import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBadge } from './StatusBadge'
import styles from './StatusBadge.module.css'

describe('StatusBadge', () => {
  it('renders a label and a dot by default', () => {
    const { container } = render(<StatusBadge tone="success">Активен</StatusBadge>)

    expect(screen.getByText('Активен')).toBeInTheDocument()
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('can hide the dot', () => {
    const { container } = render(
      <StatusBadge dot={false} tone="warning">
        Cooldown
      </StatusBadge>,
    )

    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull()
  })

  it('applies every tone class', () => {
    const tones = ['success', 'warning', 'danger', 'info', 'neutral'] as const

    for (const tone of tones) {
      const { container, unmount } = render(
        <StatusBadge tone={tone}>{tone}</StatusBadge>,
      )

      expect(container.firstElementChild).toHaveClass(styles[tone]!)
      unmount()
    }
  })
})
