import type { ReactNode } from 'react'

import MuiCard from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

export type CardTone = 'default' | 'muted'

export interface CardProps {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  tone?: CardTone
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  tone = 'default',
}: CardProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined

  return (
    <MuiCard
      className={className}
      data-tone={tone}
      sx={{
        bgcolor: tone === 'muted' ? 'rgba(16, 26, 49, 0.55)' : 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
      variant="outlined"
    >
      {hasHeader ? (
        <>
          <CardHeader
            action={actions}
            subheader={
              description !== undefined ? (
                <Typography color="text.secondary" variant="body2">
                  {description}
                </Typography>
              ) : undefined
            }
            title={
              title !== undefined ? (
                <Typography component="h2" fontWeight={650} variant="subtitle1">
                  {title}
                </Typography>
              ) : undefined
            }
          />
          <Divider />
        </>
      ) : null}
      <CardContent sx={{ flexGrow: 1 }}>{children}</CardContent>
    </MuiCard>
  )
}
