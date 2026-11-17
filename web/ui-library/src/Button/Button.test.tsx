import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
  it('renders its children as a contained primary button', () => {
    render(<Button>Отправить</Button>)

    const button = screen.getByRole('button', { name: 'Отправить' })

    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('MuiButton-contained')
    expect(button).toHaveClass('MuiButton-colorPrimary')
    expect(button).toHaveClass('MuiButton-sizeMedium')
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
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('maps the danger variant and small size', () => {
    render(
      <Button className="custom" size="sm" variant="danger">
        Удалить
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Удалить' })

    expect(button).toHaveClass('MuiButton-contained')
    expect(button).toHaveClass('MuiButton-colorError')
    expect(button).toHaveClass('MuiButton-sizeSmall')
    expect(button).toHaveClass('custom')
  })

  it('supports the secondary and ghost variants and full width', () => {
    const { rerender } = render(
      <Button fullWidth variant="secondary">
        Вторичная
      </Button>,
    )

    const secondary = screen.getByRole('button', { name: 'Вторичная' })

    expect(secondary).toHaveClass('MuiButton-outlined')
    expect(secondary).toHaveClass('MuiButton-fullWidth')

    rerender(<Button variant="ghost">Призрачная</Button>)

    expect(screen.getByRole('button', { name: 'Призрачная' })).toHaveClass('MuiButton-text')
  })
})
