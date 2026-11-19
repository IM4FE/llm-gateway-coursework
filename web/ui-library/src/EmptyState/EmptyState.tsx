import type { ReactNode } from 'react'

import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

export interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Paper
      sx={{
        alignItems: 'center',
        borderStyle: 'dashed',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 4,
        textAlign: 'center',
      }}
      variant="outlined"
    >
      <Box aria-hidden="true" component="span" sx={{ color: 'text.secondary', fontSize: 28, lineHeight: 1 }}>
        ∅
      </Box>
      <Typography component="h3" fontWeight={650} variant="subtitle1">
        {title}
      </Typography>
      {description !== undefined ? (
        <Typography color="text.secondary" maxWidth={460} variant="body2">
          {description}
        </Typography>
      ) : null}
      {action !== undefined ? <Box sx={{ mt: 1 }}>{action}</Box> : null}
    </Paper>
  )
}
