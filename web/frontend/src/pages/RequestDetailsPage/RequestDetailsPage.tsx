import { Link, useParams } from 'react-router-dom'

import { Card, EmptyState, PageHeader, StatCard, StatusBadge } from '@llm-gateway/ui'

import { requests } from '../../data/mockData'
import {
  attemptStatusTone,
  formatDateTime,
  formatMicros,
  requestStatusTone,
} from '../../lib/format'

export function RequestDetailsPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const request = requests.find((item) => item.id === requestId)

  if (request === undefined) {
    return (
      <div className="page">
        <EmptyState
          action={
            <Link className="link" to="/requests">
              ← Ко всем запросам
            </Link>
          }
          description={`Запрос с id «${requestId ?? '—'}» не найден.`}
          title="Запрос не найден"
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link className="link" to="/requests">
          Запросы
        </Link>
        <span>/</span>
        <span className="mono">{request.requestId}</span>
      </div>

      <PageHeader
        actions={
          <StatusBadge tone={requestStatusTone(request.status)}>
            {request.status}
          </StatusBadge>
        }
        description={`Клиент ${request.client} · ${formatDateTime(request.createdAt)}`}
        eyebrow="Request"
        title={`Запрос ${request.requestId}`}
      />

      <div className="stat-grid">
        <StatCard label="Модель" value={request.model} />
        <StatCard label="Провайдер" tone="success" value={request.provider} />
        <StatCard
          hint={`${request.promptTokens} prompt + ${request.completionTokens} completion`}
          label="Токены"
          value={request.promptTokens + request.completionTokens}
        />
        <StatCard label="Стоимость" value={formatMicros(request.costMicros)} />
      </div>

      <Card description="Каждая строка — одна попытка Router'а." title="Попытки">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Провайдер</th>
                <th scope="col">Статус</th>
                <th scope="col">Код ошибки</th>
                <th scope="col">Latency</th>
              </tr>
            </thead>
            <tbody>
              {request.attempts.map((attempt) => (
                <tr key={attempt.attempt}>
                  <td>{attempt.attempt}</td>
                  <td>{attempt.provider}</td>
                  <td>
                    <StatusBadge tone={attemptStatusTone(attempt.status)}>
                      {attempt.status}
                    </StatusBadge>
                  </td>
                  <td className="mono">{attempt.errorCode ?? '—'}</td>
                  <td className="mono">{attempt.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Идентификаторы">
        <dl className="detail-list">
          <dt>Внутренний id</dt>
          <dd className="mono">{request.id}</dd>
          <dt>X-Request-Id</dt>
          <dd className="mono">{request.requestId}</dd>
          <dt>Alias</dt>
          <dd className="mono">{request.model}</dd>
        </dl>
      </Card>
    </div>
  )
}
