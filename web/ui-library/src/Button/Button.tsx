import type { ReactNode } from 'react'

import MuiButton from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'

import type { ButtonProps as MuiButtonProps } from '@mui/material/Button'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends Omit<MuiButtonProps, 'variant' | 'size' | 'color'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  children: ReactNode
}

const VARIANT_PROPS = {
  primary: { variant: 'contained', color: 'primary' },
  secondary: { variant: 'outlined', color: 'primary' },
  ghost: { variant: 'text', color: 'inherit' },
  danger: { variant: 'contained', color: 'error' },
} as const satisfies Record<ButtonVariant, Pick<MuiButtonProps, 'variant' | 'color'>>

const SIZE_PROPS = {
  sm: 'small',
  md: 'medium',
} as const satisfies Record<ButtonSize, 'small' | 'medium'>

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  startIcon,
  ...rest
}: ButtonProps) {
  return (
    <MuiButton
      {...rest}
      color={VARIANT_PROPS[variant].color}
      disabled={disabled || loading}
      size={SIZE_PROPS[size]}
      startIcon={loading ? <CircularProgress color="inherit" size={14} /> : startIcon}
      variant={VARIANT_PROPS[variant].variant}
    >
      {children}
    </MuiButton>
  )
}
