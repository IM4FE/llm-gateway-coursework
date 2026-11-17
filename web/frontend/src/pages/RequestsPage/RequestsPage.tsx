import { Link } from 'react-router-dom'

import { Card, EmptyState, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { requests } from '../../data/mockData'
import { formatDateTime, formatMicros, requestStatusTone } from '../../lib/format'

export function RequestsPage() {
  return (
    <div className="page">
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
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Request id</th>
                  <th scope="col">Модель</th>
                  <th scope="col">Клиент</th>
                  <th scope="col">Провайдер</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Стоимость</th>
                  <th scope="col">Время</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link className="mono" to={`/requests/${request.id}`}>
                        {request.requestId}
                      </Link>
                    </td>
                    <td className="mono">{request.model}</td>
                    <td>{request.client}</td>
                    <td>{request.provider}</td>
                    <td>
                      <StatusBadge tone={requestStatusTone(request.status)}>
                        {request.status}
                      </StatusBadge>
                    </td>
                    <td className="mono">{formatMicros(request.costMicros)}</td>
                    <td className="muted">{formatDateTime(request.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="alert alert-info">
        Backend уже пишет <code>request_logs</code> и{' '}
        <code>request_attempts</code>. Страница пока показывает mock-снимок;
        подключение к admin API — следующий шаг.
      </div>
    </div>
  )
}
