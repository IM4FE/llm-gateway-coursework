import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import { Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { modelRoutes } from '../../data/mockData'
import { formatMicros, routeStatusTone } from '../../lib/format'

export function ModelsPage() {
  return (
    <Stack gap={3}>
      <PageHeader
        description="Alias-модели, которые видят клиенты, и upstream-модели провайдеров."
        eyebrow="Routes"
        title="Маршруты моделей"
      />

      <Card description="Чем меньше priority, тем раньше маршрут участвует в fallback.">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Alias</TableCell>
                <TableCell>Провайдер</TableCell>
                <TableCell>Upstream model</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Input / 1M</TableCell>
                <TableCell>Output / 1M</TableCell>
                <TableCell>Статус</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {modelRoutes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{route.alias}</TableCell>
                  <TableCell>{route.provider}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{route.upstreamModel}</TableCell>
                  <TableCell>{route.priority}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {formatMicros(route.inputPriceMicrosPer1m)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {formatMicros(route.outputPriceMicrosPer1m)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={routeStatusTone(route.status)}>{route.status}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Alert severity="info">
        Цены хранятся в micro-USD за 1M токенов и отображаются в USD. В backend маршруты уже
        читаются из таблиц <Box component="code">models</Box> и <Box component="code">model_routes</Box>.
      </Alert>
    </Stack>
  )
}
