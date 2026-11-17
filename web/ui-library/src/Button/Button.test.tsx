import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'
import styles from './Button.module.css'

describe('Button', () => {
  it('renders its children and defaults to a non-submit button', () => {
    render(<Button>Отправить</Button>)

    const button = screen.getByRole('button', { name: 'Отправить' })

    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass(styles.primary!)
    expect(button).toHaveClass(styles.md!)
  })

  it('calls onClick and supports the submit type', () => {
    const onClick = vi.fn()

    render(
      <Button onClick={onClick} type="submit">
        Сохранить
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Сохранить' })

    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button).toHaveAttribute('type', 'submit')
  })

  it('is disabled when disabled is true', () => {
    render(<Button disabled>Недоступно</Button>)

    expect(screen.getByRole('button', { name: 'Недоступно' })).toBeDisabled()
  })

  it('is disabled and shows a spinner while loading', () => {
    render(<Button loading>Загрузка</Button>)

    const button = screen.getByRole('button', { name: 'Загрузка' })

    expect(button).toBeDisabled()
    expect(button.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('applies variant, size, full width and custom class names', () => {
    render(
      <Button className="custom" fullWidth size="sm" variant="danger">
        Удалить
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Удалить' })

    expect(button).toHaveClass(styles.danger!)
    expect(button).toHaveClass(styles.sm!)
    expect(button).toHaveClass(styles.fullWidth!)
    expect(button).toHaveClass('custom')
  })
})
