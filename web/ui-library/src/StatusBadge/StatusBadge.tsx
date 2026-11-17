import type { ReactNode } from 'react'

import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusBadgeProps {
  tone?: StatusTone
  dot?: boolean
  children: ReactNode
}

const TONE_COLOR = {
  success: 'success',
  warning: 'warning',
  danger: 'error',
  info: 'info',
  neutral: 'default',
} as const satisfies Record<StatusTone, 'success' | 'warning' | 'error' | 'info' | 'default'>

export function StatusBadge({ tone = 'neutral', dot = true, children }: StatusBadgeProps) {
  return (
    <Chip
      color={TONE_COLOR[tone]}
      icon={
        dot ? (
          <Box
            aria-hidden="true"
            component="span"
            sx={{ bgcolor: 'currentColor', borderRadius: '50%', height: 6, width: 6 }}
          />
        ) : undefined
      }
      label={children}
      size="small"
      sx={{ fontWeight: 600 }}
      variant="outlined"
    />
  )
}
