import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
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
import { Link as RouterLink, useParams } from 'react-router-dom'

import { Card, EmptyState, PageHeader, StatCard, StatusBadge } from '@llm-gateway/ui'

import { requests } from '../../data/mockData'
import {
  attemptStatusTone,
  formatDateTime,
  formatMicros,
  requestStatusTone,
} from '../../lib/format'

interface DetailRowProps {
  label: string
  value: string
  mono?: boolean
}

function DetailRow({ label, value, mono = false }: DetailRowProps) {
  return (
    <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '180px 1fr' }}>
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

export function RequestDetailsPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const request = requests.find((item) => item.id === requestId)

  if (request === undefined) {
    return (
      <EmptyState
        action={
          <Link component={RouterLink} to="/requests" underline="hover">
            ← Ко всем запросам
          </Link>
        }
        description={`Запрос с id «${requestId ?? '—'}» не найден.`}
        title="Запрос не найден"
      />
    )
  }

  return (
    <Stack gap={3}>
      <Breadcrumbs aria-label="Хлебные крошки" sx={{ fontSize: 12 }}>
        <Link component={RouterLink} to="/requests" underline="hover">
          Запросы
        </Link>
        <Typography color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          {request.requestId}
        </Typography>
      </Breadcrumbs>

      <PageHeader
        actions={
          <StatusBadge tone={requestStatusTone(request.status)}>{request.status}</StatusBadge>
        }
        description={`Клиент ${request.client} · ${formatDateTime(request.createdAt)}`}
        eyebrow="Request"
        title={`Запрос ${request.requestId}`}
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Модель" value={request.model} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Провайдер" tone="success" value={request.provider} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            hint={`${request.promptTokens} prompt + ${request.completionTokens} completion`}
            label="Токены"
            value={request.promptTokens + request.completionTokens}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Стоимость" value={formatMicros(request.costMicros)} />
        </Grid>
      </Grid>

      <Card description="Каждая строка — одна попытка Router'а." title="Попытки">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Провайдер</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Код ошибки</TableCell>
                <TableCell>Latency</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {request.attempts.map((attempt) => (
                <TableRow key={attempt.attempt}>
                  <TableCell>{attempt.attempt}</TableCell>
                  <TableCell>{attempt.provider}</TableCell>
                  <TableCell>
                    <StatusBadge tone={attemptStatusTone(attempt.status)}>{attempt.status}</StatusBadge>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {attempt.errorCode ?? '—'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{attempt.latencyMs} ms</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Card title="Идентификаторы">
        <Stack gap={1.5}>
          <DetailRow label="Внутренний id" mono value={request.id} />
          <DetailRow label="X-Request-Id" mono value={request.requestId} />
          <DetailRow label="Alias" mono value={request.model} />
        </Stack>
      </Card>
    </Stack>
  )
}
