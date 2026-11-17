import { Link } from 'react-router-dom'

import { Card, PageHeader, StatCard, StatusBadge } from '@llm-gateway/ui'

import { modelRoutes, providers, requests } from '../../data/mockData'
import {
  formatDateTime,
  formatMicros,
  providerStatusTone,
  requestStatusTone,
  routeStatusTone,
} from '../../lib/format'

export function DashboardPage() {
  const successCount = requests.filter((request) => request.status === 'success').length
  const errorCount = requests.filter((request) => request.status === 'error').length
  const totalCost = requests.reduce((sum, request) => sum + request.costMicros, 0)
  const activeProviders = providers.filter((provider) => provider.status === 'active').length

  return (
    <div className="page">
      <PageHeader
        actions={
          <Link className="link" to="/playground">
            Открыть playground →
          </Link>
        }
        description="Состояние шлюза, маршрутов и последних запросов. Данные на этой странице — mock-снимок для каркаса интерфейса."
        eyebrow="Overview"
        title="Панель управления"
      />

      <div className="stat-grid">
        <StatCard
          hint={`${activeProviders} активны`}
          icon="⬡"
          label="Провайдеры"
          value={providers.length}
        />
        <StatCard
          hint="alias → upstream"
          icon="⇄"
          label="Маршруты"
          tone="success"
          value={modelRoutes.length}
        />
        <StatCard
          hint={`${successCount} успешно / ${errorCount} с ошибкой`}
          icon="↗"
          label="Запросы"
          tone={errorCount > 0 ? 'warning' : 'success'}
          value={requests.length}
        />
        <StatCard
          hint="по журналу запросов"
          icon="$"
          label="Стоимость"
          value={formatMicros(totalCost)}
        />
      </div>

      <div className="page-grid">
        <Card
          actions={
            <Link className="link" to="/requests">
              Все запросы
            </Link>
          }
          description="Последние обращения клиентов к alias-моделям."
          title="Последние запросы"
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Модель</th>
                  <th scope="col">Провайдер</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Стоимость</th>
                  <th scope="col">Время</th>
                </tr>
              </thead>
              <tbody>
                {requests.slice(0, 4).map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link className="mono" to={`/requests/${request.id}`}>
                        {request.model}
                      </Link>
                    </td>
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
        </Card>

        <Card
          description="Приоритет и состояние fallback-цепочек."
          title="Маршруты"
        >
          <div className="stack">
            {modelRoutes.map((route) => (
              <div className="route-row" key={route.id}>
                <div className="route-main">
                  <span className="mono">{route.alias}</span>
                  <span className="muted">→</span>
                  <span>{route.upstreamModel}</span>
                </div>
                <div className="row">
                  <span className="muted">priority {route.priority}</span>
                  <StatusBadge tone={routeStatusTone(route.status)}>
                    {route.status}
                  </StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card description="Провайдеры, у которых открыт circuit breaker или отключён маршрут." title="Требуют внимания">
        <div className="stack">
          {providers
            .filter((provider) => provider.status !== 'active')
            .map((provider) => (
              <div className="route-row" key={provider.id}>
                <div className="route-main">
                  <Link className="link" to={`/providers/${provider.id}`}>
                    {provider.name}
                  </Link>
                  <span className="muted">{provider.description}</span>
                </div>
                <StatusBadge tone={providerStatusTone(provider.status)}>
                  {provider.status}
                </StatusBadge>
              </div>
            ))}
        </div>
      </Card>
    </div>
  )
}
