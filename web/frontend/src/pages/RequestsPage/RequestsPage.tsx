import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
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

import { Card, EmptyState, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { requests } from '../../data/mockData'
import { formatDateTime, formatMicros, requestStatusTone } from '../../lib/format'

export function RequestsPage() {
  return (
    <Stack gap={3}>
      <PageHeader
        description="Журнал запросов: alias, выбранный провайдер, стоимость и итоговый статус."
        eyebrow="Observability"
        title="Запросы"
      />

      <Card description="Нажмите на request id, чтобы увидеть все попытки и fallback-цепочку.">
        {requests.length === 0 ? (
          <EmptyState
            description="Отправьте первый запрос через playground или API."
            title="Журнал пуст"
          />
        ) : (
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
                        to={`/requests/${request.id}`}
                        underline="hover"
                      >
                        {request.requestId}
                      </Link>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{request.model}</TableCell>
                    <TableCell>{request.client}</TableCell>
                    <TableCell>{request.provider}</TableCell>
                    <TableCell>
                      <StatusBadge tone={requestStatusTone(request.status)}>{request.status}</StatusBadge>
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
        )}
      </Card>

      <Alert severity="info">
        Backend уже пишет <Box component="code">request_logs</Box> и{' '}
        <Box component="code">request_attempts</Box>. Страница пока показывает mock-снимок;
        подключение к admin API — следующий шаг.
      </Alert>
    </Stack>
  )
}
