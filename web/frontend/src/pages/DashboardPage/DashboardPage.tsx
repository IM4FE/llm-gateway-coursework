import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'

import { Card, PageHeader, StatCard, StatusBadge } from '@llm-gateway/ui'

import { modelRoutes, providers, requests } from '../../data/mockData'
import {
  formatDateTime,
  formatMicros,
  providerStatusTone,
  requestStatusTone,
  routeStatusTone,
} from '../../lib/format'

const MONO = { fontFamily: 'monospace', fontSize: 12 } as const

export function DashboardPage() {
  const successCount = requests.filter((request) => request.status === 'success').length
  const errorCount = requests.filter((request) => request.status === 'error').length
  const totalCost = requests.reduce((sum, request) => sum + request.costMicros, 0)
  const activeProviders = providers.filter((provider) => provider.status === 'active').length

  return (
    <Stack gap={3}>
      <PageHeader
        actions={
          <Link component={RouterLink} to="/playground" underline="hover">
            Открыть песочницу →
          </Link>
        }
        description="Состояние шлюза, маршрутов и последних запросов. Данные на этой странице — mock-снимок для каркаса интерфейса."
        eyebrow="Overview"
        title="Панель управления"
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard hint={`${activeProviders} активны`} icon="⬡" label="Провайдеры" value={providers.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard hint="alias → upstream" icon="⇄" label="Маршруты" tone="success" value={modelRoutes.length} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            hint={`${successCount} успешно / ${errorCount} с ошибкой`}
            icon="↗"
            label="Запросы"
            tone={errorCount > 0 ? 'warning' : 'success'}
            value={requests.length}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard hint="по журналу запросов" icon="$" label="Стоимость" value={formatMicros(totalCost)} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card
            actions={
              <Link component={RouterLink} to="/requests" underline="hover" variant="body2">
                Все запросы
              </Link>
            }
            description="Последние обращения клиентов к alias-моделям."
            title="Последние запросы"
          >
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Модель</TableCell>
                    <TableCell>Провайдер</TableCell>
                    <TableCell>Статус</TableCell>
                    <TableCell>Стоимость</TableCell>
                    <TableCell>Время</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.slice(0, 4).map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <Link component={RouterLink} sx={MONO} to={`/requests/${request.id}`} underline="hover">
                          {request.model}
                        </Link>
                      </TableCell>
                      <TableCell>{request.provider}</TableCell>
                      <TableCell>
                        <StatusBadge tone={requestStatusTone(request.status)}>{request.status}</StatusBadge>
                      </TableCell>
                      <TableCell sx={MONO}>{formatMicros(request.costMicros)}</TableCell>
                      <TableCell>
                        <Typography color="text.secondary" variant="body2">
                          {formatDateTime(request.createdAt)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card description="Приоритет и состояние fallback-цепочек." title="Маршруты">
            <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />} gap={1.5}>
              {modelRoutes.map((route) => (
                <Stack alignItems="center" direction="row" gap={2} justifyContent="space-between" key={route.id}>
                  <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1} sx={{ minWidth: 0 }}>
                    <Typography sx={MONO}>{route.alias}</Typography>
                    <Typography color="text.secondary">→</Typography>
                    <Typography variant="body2">{route.upstreamModel}</Typography>
                  </Stack>
                  <Stack alignItems="center" direction="row" gap={1.25} sx={{ flexShrink: 0 }}>
                    <Typography color="text.secondary" sx={{ whiteSpace: 'nowrap' }} variant="caption">
                      priority {route.priority}
                    </Typography>
                    <StatusBadge tone={routeStatusTone(route.status)}>{route.status}</StatusBadge>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <Card description="Провайдеры, у которых открыт circuit breaker или отключён маршрут." title="Требуют внимания">
        <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />} gap={1.5}>
          {providers
            .filter((provider) => provider.status !== 'active')
            .map((provider) => (
              <Stack alignItems="center" direction="row" gap={2} justifyContent="space-between" key={provider.id}>
                <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1} sx={{ minWidth: 0 }}>
                  <Link component={RouterLink} to={`/providers/${provider.id}`} underline="hover">
                    {provider.name}
                  </Link>
                  <Typography color="text.secondary" variant="body2">
                    {provider.description}
                  </Typography>
                </Stack>
                <StatusBadge tone={providerStatusTone(provider.status)}>{provider.status}</StatusBadge>
              </Stack>
            ))}
        </Stack>
      </Card>
    </Stack>
  )
}
