import { useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import CircularProgress from '@mui/material/CircularProgress'
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

import { Button, Card, EmptyState, PageHeader, StatCard, StatusBadge } from '@llm-gateway/ui'

import { describeApiError, fetchRequestLogDetails } from '../../lib/api'
import {
  attemptStatusTone,
  formatDateTime,
  formatMicros,
  requestStatusTone,
} from '../../lib/format'

import type { RequestLogDetails } from '../../data/types'

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

function BackToJournal() {
  return (
    <Link component={RouterLink} to="/requests" underline="hover">
      ← Ко всем запросам
    </Link>
  )
}

export function RequestDetailsPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const [request, setRequest] = useState<RequestLogDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (requestId === undefined) {
      setRequest(null)
      setLoading(false)

      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)
    setRequest(null)

    void fetchRequestLogDetails(requestId)
      .then((details) => {
        if (!cancelled) {
          setRequest(details)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(describeApiError(caught))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [requestId, version])

  if (loading) {
    return (
      <Stack alignItems="center" direction="row" gap={1.5} justifyContent="center" py={6}>
        <CircularProgress size={22} />
        <Typography color="text.secondary" variant="body2">
          Загружаем запрос…
        </Typography>
      </Stack>
    )
  }

  if (error !== null) {
    return (
      <Stack gap={2}>
        <Alert
          action={
            <Button onClick={() => setVersion((current) => current + 1)} size="sm" variant="ghost">
              Повторить
            </Button>
          }
          severity="error"
        >
          {error}
        </Alert>
        <BackToJournal />
      </Stack>
    )
  }

  if (request === null) {
    return (
      <EmptyState
        action={<BackToJournal />}
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
        description={`Клиент ${request.clientName ?? '—'} · ${formatDateTime(request.createdAt)}`}
        eyebrow="Request"
        title={`Запрос ${request.requestId}`}
      />

      {request.errorCode !== null ? (
        <Alert severity="warning">
          Итоговая ошибка: <Box component="code">{request.errorCode}</Box>
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Модель" value={request.requestedModel} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Провайдер" tone="success" value={request.providerName ?? '—'} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            hint={`${request.promptTokens} prompt + ${request.completionTokens} completion`}
            label="Токены"
            value={request.totalTokens}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Стоимость" value={formatMicros(request.costMicros)} />
        </Grid>
      </Grid>

      <Card description="Каждая строка — одна попытка Router'а." title="Попытки">
        {request.attempts.length === 0 ? (
          <EmptyState
            description="Запрос завершился до обращения к провайдеру."
            title="Попыток нет"
          />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Провайдер</TableCell>
                  <TableCell>Статус</TableCell>
                  <TableCell>HTTP</TableCell>
                  <TableCell>Код ошибки</TableCell>
                  <TableCell>Latency</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {request.attempts.map((attempt) => (
                  <TableRow key={attempt.attemptNo}>
                    <TableCell>{attempt.attemptNo}</TableCell>
                    <TableCell>{attempt.providerName ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge tone={attemptStatusTone(attempt.status)}>
                        {attempt.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {attempt.httpStatus ?? '—'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {attempt.errorCode ?? '—'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {attempt.latencyMs} ms
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Card title="Идентификаторы">
        <Stack gap={1.5}>
          <DetailRow label="Внутренний id" mono value={request.id} />
          <DetailRow label="X-Request-Id" mono value={request.requestId} />
          <DetailRow label="Alias" mono value={request.requestedModel} />
          <DetailRow label="Фактическая модель" mono value={request.actualModel ?? '—'} />
          <DetailRow label="Latency" mono value={`${request.latencyMs} ms`} />
          <DetailRow label="TTFT" mono value={request.ttftMs === null ? '—' : `${request.ttftMs} ms`} />
          <DetailRow label="Streaming" value={request.isStream ? 'да' : 'нет'} />
        </Stack>
      </Card>
    </Stack>
  )
}
