import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
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

import { Button, Card, EmptyState, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { useRequestLogs } from '../../hooks/useRequestLogs'
import { formatDateTime, formatMicros, requestStatusTone } from '../../lib/format'

export function RequestsPage() {
  const { requests, loading, error, reload } = useRequestLogs()

  return (
    <Stack gap={3}>
      <PageHeader
        description="Журнал запросов: alias, выбранный провайдер, стоимость и итоговый статус."
        eyebrow="Observability"
        title="Запросы"
      />

      <Card
        actions={
          <Button disabled={loading} onClick={reload} size="sm" variant="secondary">
            Обновить
          </Button>
        }
        description="Нажмите на request id, чтобы увидеть все попытки и fallback-цепочку."
      >
        <Stack gap={2}>
          {error !== null ? (
            <Alert
              action={
                <Button onClick={reload} size="sm" variant="ghost">
                  Повторить
                </Button>
              }
              severity="error"
            >
              {error}
            </Alert>
          ) : null}

          {loading ? (
            <Stack alignItems="center" direction="row" gap={1.5} justifyContent="center" py={3}>
              <CircularProgress size={22} />
              <Typography color="text.secondary" variant="body2">
                Загружаем журнал запросов…
              </Typography>
            </Stack>
          ) : null}

          {!loading && error === null && requests.length === 0 ? (
            <EmptyState
              description="Отправьте первый запрос через песочницу или API."
              title="Журнал пуст"
            />
          ) : null}

          {requests.length > 0 ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Request id</TableCell>
                    <TableCell>Модель</TableCell>
                    <TableCell>Клиент</TableCell>
                    <TableCell>Провайдер</TableCell>
                    <TableCell>Статус</TableCell>
                    <TableCell>Стоимость</TableCell>
                    <TableCell>Время</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <Link
                          component={RouterLink}
                          sx={{ fontFamily: 'monospace', fontSize: 12 }}
                          to={`/requests/${request.requestId}`}
                          underline="hover"
                        >
                          {request.requestId}
                        </Link>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {request.requestedModel}
                      </TableCell>
                      <TableCell>{request.clientName ?? '—'}</TableCell>
                      <TableCell>{request.providerName ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge tone={requestStatusTone(request.status)}>
                          {request.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {formatMicros(request.costMicros)}
                      </TableCell>
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
          ) : null}
        </Stack>
      </Card>

      <Alert severity="info">
        Журнал читается из backend: <Box component="code">GET /api/requests</Box>. Запись появляется
        сразу после ответа песочницы, поэтому запрос можно найти по{' '}
        <Box component="code">X-Request-Id</Box>.
      </Alert>
    </Stack>
  )
}
