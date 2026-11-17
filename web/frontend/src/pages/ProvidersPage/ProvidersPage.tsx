import Alert from '@mui/material/Alert'
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

import { Button, Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { providers } from '../../data/mockData'
import { providerStatusLabel, providerStatusTone } from '../../lib/format'

export function ProvidersPage() {
  return (
    <Stack gap={3}>
      <PageHeader
        actions={
          <Button disabled title="CRUD появится в следующем инкременте">
            Добавить провайдера
          </Button>
        }
        description="Подключения к OpenAI-совместимым провайдерам, состояние ключей и latency."
        eyebrow="Providers"
        title="Провайдеры"
      />

      <Card description="Нажмите на имя провайдера, чтобы открыть детали.">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Провайдер</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Модели</TableCell>
                <TableCell>Ключи</TableCell>
                <TableCell>Latency</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell>
                    <Link component={RouterLink} to={`/providers/${provider.id}`} underline="hover">
                      {provider.name}
                    </Link>
                    <Typography color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {provider.baseUrl}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={providerStatusTone(provider.status)}>
                      {providerStatusLabel(provider.status)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{provider.models}</TableCell>
                  <TableCell>{provider.keys}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{provider.latencyMs} ms</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Alert severity="info">
        Это каркас админ-консоли: список читается из mock-данных. Создание, редактирование и
        удаление провайдеров появятся после добавления admin API в backend.
      </Alert>
    </Stack>
  )
}
