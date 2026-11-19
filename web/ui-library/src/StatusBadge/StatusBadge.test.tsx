import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBadge } from './StatusBadge'

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

  it('maps every tone to the matching MUI chip color', () => {
    const cases = [
      { tone: 'success', className: 'MuiChip-colorSuccess' },
      { tone: 'warning', className: 'MuiChip-colorWarning' },
      { tone: 'danger', className: 'MuiChip-colorError' },
      { tone: 'info', className: 'MuiChip-colorInfo' },
      { tone: 'neutral', className: 'MuiChip-colorDefault' },
    ] as const

    for (const item of cases) {
      const { container, unmount } = render(
        <StatusBadge tone={item.tone}>{item.tone}</StatusBadge>,
      )

      expect(container.firstElementChild).toHaveClass(item.className)
      unmount()
    }
  })
})
