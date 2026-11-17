import type { ReactNode } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { Button, Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { useAdminAuth } from '../../auth/useAdminAuth'

const FEATURES = [
  'CRUD провайдеров, моделей и alias-маршрутов.',
  'Управление API-ключами и ручной сброс circuit breaker.',
  'Лимиты клиентов и просмотр журнала аудита.',
]

interface DetailRowProps {
  label: string
  children: ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '160px 1fr' }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Box>{children}</Box>
    </Box>
  )
}

function maskToken(token: string | null): string {
  if (token === null) {
    return '—'
  }

  if (token.length <= 8) {
    return '••••••••'
  }

  return `${token.slice(0, 4)}••••${token.slice(-4)}`
}

export function SettingsPage() {
  const { token, signOut } = useAdminAuth()

  return (
    <Stack gap={3}>
      <PageHeader
        actions={
          <Button onClick={signOut} variant="danger">
            Выйти из админки
          </Button>
        }
        description="Защищённый раздел. В демо-версии токен хранится в sessionStorage и не проверяется backend."
        eyebrow="Admin"
        title="Настройки"
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card title="Сессия">
            <Stack gap={1.5}>
              <DetailRow label="Статус">
                <StatusBadge tone="success">authenticated</StatusBadge>
              </DetailRow>
              <DetailRow label="Admin token">
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>{maskToken(token)}</Typography>
              </DetailRow>
              <DetailRow label="Хранилище">
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>sessionStorage</Typography>
              </DetailRow>
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card title="Что появится дальше">
            <List dense disablePadding>
              {FEATURES.map((feature) => (
                <ListItem disableGutters key={feature} sx={{ alignItems: 'flex-start' }}>
                  <ListItemText
                    primary={feature}
                    slotProps={{ primary: { color: 'text.secondary', fontSize: 13 } }}
                  />
                </ListItem>
              ))}
            </List>
          </Card>
        </Grid>
      </Grid>

      <Alert severity="info">
        Защищённый маршрут <Box component="code">/settings</Box> реализован через{' '}
        <Box component="code">RequireAdmin</Box>. При отсутствии сессии пользователь
        перенаправляется на <Box component="code">/login?redirect=...</Box>.
      </Alert>
    </Stack>
  )
}
