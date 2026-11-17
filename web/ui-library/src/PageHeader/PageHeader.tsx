import type { ReactNode } from 'react'

import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

export interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <Stack
      alignItems={{ xs: 'flex-start', md: 'flex-end' }}
      direction={{ xs: 'column', md: 'row' }}
      gap={2}
      justifyContent="space-between"
    >
      <Stack gap={0.75} maxWidth={760}>
        {eyebrow !== undefined ? (
          <Typography color="primary" fontWeight={700} letterSpacing="0.14em" variant="overline">
            {eyebrow}
          </Typography>
        ) : null}
        <Typography component="h1" variant="h4">
          {title}
        </Typography>
        {description !== undefined ? (
          <Typography color="text.secondary" variant="body2">
            {description}
          </Typography>
        ) : null}
      </Stack>
      {actions !== undefined ? (
        <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {actions}
        </Box>
      ) : null}
    </Stack>
  )
}
