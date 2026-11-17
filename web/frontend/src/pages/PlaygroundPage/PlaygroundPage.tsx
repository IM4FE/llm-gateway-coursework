import { useState } from 'react'
import type { FormEvent } from 'react'

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

const MODEL_ALIASES = [...new Set(modelRoutes.map((route) => route.alias))]

export function PlaygroundPage() {
  const [model, setModel] = useState(MODEL_ALIASES[0] ?? 'fast-model')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('Объясни в двух предложениях, что делает circuit breaker в LLM-шлюзе.')
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
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        setError(extractError(payload) ?? `HTTP ${response.status}`)

        return
      }

      const content = extractContent(payload)

      if (content === null) {
        setError('Ответ не содержит choices[0].message.content.')

        return
      }

      setAnswer(content)
      setProvider(extractProvider(payload))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить запрос.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        description="Отправьте запрос в запущенный backend через Vite proxy. Ключ хранится только в состоянии страницы."
        eyebrow="Playground"
        title="Playground"
      />

      <div className="page-grid">
        <Card description="POST /v1/chat/completions" title="Запрос">
          <form className="form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="playground-model">Alias модели</label>
              <select
                className="select"
                id="playground-model"
                onChange={(event) => setModel(event.target.value)}
                value={model}
              >
                {MODEL_ALIASES.map((alias) => (
                  <option key={alias} value={alias}>
                    {alias}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="playground-key">Клиентский ключ</label>
              <input
                autoComplete="off"
                className="input"
                id="playground-key"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="lgw_..."
                type="password"
                value={apiKey}
              />
            </div>

            <div className="field">
              <label htmlFor="playground-prompt">Сообщение</label>
              <textarea
                className="textarea"
                id="playground-prompt"
                onChange={(event) => setPrompt(event.target.value)}
                value={prompt}
              />
            </div>

            <Button fullWidth loading={loading} type="submit">
              Отправить запрос
            </Button>
          </form>
        </Card>

        <Card
          actions={provider !== null ? <StatusBadge tone="success">{provider}</StatusBadge> : null}
          description="Ответ шлюза или текст ошибки."
          title="Ответ"
        >
          {error !== null ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}

          {answer !== null ? (
            <div className="result">{answer}</div>
          ) : null}

          {error === null && answer === null ? (
            <div className="empty-note">
              Заполните ключ и нажмите «Отправить запрос». Для работы нужен
              backend на <code>http://localhost:3000</code>.
            </div>
          ) : null}
        </Card>
      </div>

      <div className="alert alert-info">
        Vite dev-сервер проксирует <code>/v1</code> на backend, поэтому CORS не
        требуется. В production тот же путь должен обслуживать reverse proxy.
      </div>
    </div>
  )
}
