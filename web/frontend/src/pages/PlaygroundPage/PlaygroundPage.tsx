import { useState } from 'react'
import type { FormEvent } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { Button, Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { modelRoutes } from '../../data/mockData'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractError(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null
  }

  const message = payload.error.message

  return typeof message === 'string' ? message : null
}

function extractContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return null
  }

  const first = payload.choices[0]

  if (!isRecord(first) || !isRecord(first.message)) {
    return null
  }

  const content = first.message.content

  return typeof content === 'string' ? content : null
}

function extractProvider(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.provider !== 'string') {
    return null
  }

  return payload.provider
}

const BACKEND_HINT = 'Проверьте, что backend запущен на http://localhost:3000.'

interface ResponseBody {
  payload: unknown
  raw: string
}

async function readBody(response: Response): Promise<ResponseBody> {
  const raw = await response.text()

  if (raw.trim() === '') {
    return { payload: null, raw }
  }

  try {
    return { payload: JSON.parse(raw), raw }
  } catch {
    return { payload: null, raw }
  }
}

function describeFailure(response: Response, body: ResponseBody): string {
  const apiMessage = extractError(body.payload)

  if (apiMessage !== null) {
    return apiMessage
  }

  if (body.raw.trim() === '') {
    return `Шлюз не вернул тело ответа (HTTP ${response.status}). ${BACKEND_HINT}`
  }

  if (body.payload === null) {
    return `Шлюз ответил HTTP ${response.status}, но тело ответа не JSON. ${BACKEND_HINT}`
  }

  return `Шлюз ответил HTTP ${response.status}.`
}

function describeNetworkError(caught: unknown): string {
  if (caught instanceof TypeError) {
    return `Не удалось соединиться со шлюзом. ${BACKEND_HINT}`
  }

  return caught instanceof Error ? caught.message : 'Не удалось выполнить запрос.'
}

const MODEL_ALIASES = [...new Set(modelRoutes.map((route) => route.alias))]

const SYSTEM_PROMPT =
  'Отвечай на русском языке, если пользователь не попросил ответить на другом языке.'

export function PlaygroundPage() {
  const [model, setModel] = useState(MODEL_ALIASES[0] ?? 'fast-model')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState(
    'Объясни в двух предложениях, что делает circuit breaker в LLM-шлюзе.',
  )
  const [answer, setAnswer] = useState<string | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (apiKey.trim() === '') {
      setError('Введите клиентский ключ, созданный командой npm run db:create-client.')

      return
    }

    setLoading(true)
    setError(null)
    setAnswer(null)
    setProvider(null)

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      })
      const body = await readBody(response)

      if (!response.ok) {
        setError(describeFailure(response, body))

        return
      }

      if (body.raw.trim() === '') {
        setError(`Шлюз вернул пустой ответ (HTTP ${response.status}). ${BACKEND_HINT}`)

        return
      }

      const content = extractContent(body.payload)

      if (content === null) {
        setError('Ответ не содержит choices[0].message.content.')

        return
      }

      setAnswer(content)
      setProvider(extractProvider(body.payload))
    } catch (caught) {
      setError(describeNetworkError(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack gap={3}>
      <PageHeader
        description="Отправьте запрос в запущенный backend через Vite proxy. Ключ хранится только в состоянии страницы."
        eyebrow="Тест API"
        title="Песочница"
      />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card description="POST /v1/chat/completions" title="Запрос">
            <Stack component="form" gap={2} onSubmit={handleSubmit}>
              <TextField
                fullWidth
                id="playground-model"
                label="Alias модели"
                onChange={(event) => setModel(event.target.value)}
                select
                value={model}
              >
                {MODEL_ALIASES.map((alias) => (
                  <MenuItem key={alias} value={alias}>
                    {alias}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                autoComplete="off"
                fullWidth
                id="playground-key"
                label="Клиентский ключ"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="lgw_..."
                type="password"
                value={apiKey}
              />

              <TextField
                fullWidth
                id="playground-prompt"
                label="Сообщение"
                minRows={5}
                multiline
                onChange={(event) => setPrompt(event.target.value)}
                value={prompt}
              />

              <Typography color="text.secondary" variant="caption">
                Запрос уходит с system-сообщением «{SYSTEM_PROMPT}»
              </Typography>

              <Button fullWidth loading={loading} type="submit">
                Отправить запрос
              </Button>
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Card
            actions={provider !== null ? <StatusBadge tone="success">{provider}</StatusBadge> : undefined}
            description="Ответ шлюза или текст ошибки."
            title="Ответ"
          >
            <Stack gap={2}>
              {error !== null ? <Alert severity="error">{error}</Alert> : null}

              {answer !== null ? (
                <Paper sx={{ bgcolor: 'action.hover', p: 2, whiteSpace: 'pre-wrap' }} variant="outlined">
                  <Typography variant="body2">{answer}</Typography>
                </Paper>
              ) : null}

              {error === null && answer === null ? (
                <Box
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    borderStyle: 'dashed',
                    color: 'text.secondary',
                    p: 3,
                    textAlign: 'center',
                  }}
                >
                  <Typography variant="body2">
                    Заполните ключ и нажмите «Отправить запрос». Для работы нужен backend на{' '}
                    <Box component="code">http://localhost:3000</Box>.
                  </Typography>
                </Box>
              ) : null}
            </Stack>
          </Card>
        </Grid>
      </Grid>

      <Alert severity="info">
        Vite dev-сервер проксирует <Box component="code">/v1</Box> на backend, поэтому CORS не
        требуется. В production тот же путь должен обслуживать reverse proxy.
      </Alert>
    </Stack>
  )
}
