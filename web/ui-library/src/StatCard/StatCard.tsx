import type { ReactNode } from 'react'

import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

export type StatTone = 'default' | 'success' | 'warning' | 'danger'

export interface StatCardProps {
  label: string
  value: string | number
  hint?: string
  tone?: StatTone
  icon?: ReactNode
}

const TONE_BORDER = {
  default: 'primary.main',
  success: '#34d399',
  warning: '#fbbf24',
  danger: 'error.main',
} as const satisfies Record<StatTone, string>

export function StatCard({ label, value, hint, tone = 'default', icon }: StatCardProps) {
  return (
    <Paper
      data-tone={tone}
      sx={{
        borderTop: '3px solid',
        borderTopColor: TONE_BORDER[tone],
        height: '100%',
        p: 2.5,
      }}
      variant="outlined"
    >
      <Stack gap={1}>
        <Stack alignItems="center" direction="row" justifyContent="space-between">
          <Typography
            color="text.secondary"
            fontSize={12}
            fontWeight={600}
            letterSpacing="0.04em"
            textTransform="uppercase"
          >
            {label}
          </Typography>
          {icon !== undefined ? (
            <Box sx={{ color: 'primary.main', display: 'flex', fontSize: 18, lineHeight: 1 }}>
              {icon}
            </Box>
          ) : null}
        </Stack>
        <Typography component="strong" fontSize={28} fontWeight={700} letterSpacing="-0.02em" lineHeight={1.1}>
          {value}
        </Typography>
        {hint !== undefined ? (
          <Typography color="text.secondary" variant="caption">
            {hint}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  )
}
