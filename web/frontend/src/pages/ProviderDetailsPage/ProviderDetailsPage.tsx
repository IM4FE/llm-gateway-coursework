import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Grid from '@mui/material/Grid'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useParams } from 'react-router-dom'

import { Card, EmptyState, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { providers } from '../../data/mockData'
import { providerStatusLabel, providerStatusTone } from '../../lib/format'

interface DetailRowProps {
  label: string
  value: string | number
  mono?: boolean
}

function DetailRow({ label, value, mono = false }: DetailRowProps) {
  return (
    <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '160px 1fr' }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography
        sx={{ overflowWrap: 'anywhere', ...(mono ? { fontFamily: 'monospace', fontSize: 12 } : {}) }}
        variant="body2"
      >
        {value}
      </Typography>
    </Box>
  )
}

export function ProviderDetailsPage() {
  const { providerId } = useParams<{ providerId: string }>()
  const provider = providers.find((item) => item.id === providerId)

  if (provider === undefined) {
    return (
      <EmptyState
        action={
          <Link component={RouterLink} to="/providers" underline="hover">
            ← К списку провайдеров
          </Link>
        }
        description={`Провайдер с id «${providerId ?? '—'}» не найден в mock-данных.`}
        title="Провайдер не найден"
      />
    )
  }

  return (
    <Stack gap={3}>
      <Breadcrumbs aria-label="Хлебные крошки" sx={{ fontSize: 12 }}>
        <Link component={RouterLink} to="/providers" underline="hover">
          Провайдеры
        </Link>
        <Typography color="text.secondary" variant="body2">
          {provider.name}
        </Typography>
      </Breadcrumbs>

      <PageHeader
        actions={
          <StatusBadge tone={providerStatusTone(provider.status)}>
            {providerStatusLabel(provider.status)}
          </StatusBadge>
        }
        description={provider.description}
        eyebrow="Provider"
        title={provider.name}
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card title="Подключение">
            <Stack gap={1.5}>
              <DetailRow label="ID" mono value={provider.id} />
              <DetailRow label="Base URL" mono value={provider.baseUrl} />
              <DetailRow label="Модели" value={provider.models} />
              <DetailRow label="Ключи" value={provider.keys} />
              <DetailRow label="Средний latency" mono value={`${provider.latencyMs} ms`} />
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card description="Значения ниже — демонстрационные." title="Состояние ключей">
            <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />} gap={1.5}>
              <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1.25}>
                <StatusBadge tone="success">active</StatusBadge>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>...6937</Typography>
                <Typography color="text.secondary" variant="caption">
                  failure_count = 0
                </Typography>
              </Stack>
              <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1.25}>
                <StatusBadge tone="warning">cooldown</StatusBadge>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>...41af</Typography>
                <Typography color="text.secondary" variant="caption">
                  failure_count = 3
                </Typography>
              </Stack>
              <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1.25}>
                <StatusBadge tone="neutral">disabled</StatusBadge>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 12 }}>...0c2d</Typography>
                <Typography color="text.secondary" variant="caption">
                  is_active = false
                </Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <Alert severity="info">
        Детальная страница использует параметр маршрута <code>providerId</code>. Реальные ключи и
        их состояние будут загружаться из admin API; сейчас это заглушка.
      </Alert>
    </Stack>
  )
}
