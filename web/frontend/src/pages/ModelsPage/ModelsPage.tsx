import { Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { modelRoutes } from '../../data/mockData'
import { formatMicros, routeStatusTone } from '../../lib/format'

export function ModelsPage() {
  return (
    <div className="page">
      <PageHeader
        description="Alias-модели, которые видят клиенты, и upstream-модели провайдеров."
        eyebrow="Routes"
        title="Маршруты моделей"
      />

      <Card description="Чем меньше priority, тем раньше маршрут участвует в fallback.">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Alias</th>
                <th scope="col">Провайдер</th>
                <th scope="col">Upstream model</th>
                <th scope="col">Priority</th>
                <th scope="col">Input / 1M</th>
                <th scope="col">Output / 1M</th>
                <th scope="col">Статус</th>
              </tr>
            </thead>
            <tbody>
              {modelRoutes.map((route) => (
                <tr key={route.id}>
                  <td className="mono">{route.alias}</td>
                  <td>{route.provider}</td>
                  <td className="mono">{route.upstreamModel}</td>
                  <td>{route.priority}</td>
                  <td className="mono">{formatMicros(route.inputPriceMicrosPer1m)}</td>
                  <td className="mono">{formatMicros(route.outputPriceMicrosPer1m)}</td>
                  <td>
                    <StatusBadge tone={routeStatusTone(route.status)}>
                      {route.status}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="alert alert-info">
        Цены хранятся в micro-USD за 1M токенов и отображаются в USD. В backend
        маршруты уже читаются из таблиц <code>models</code> и{' '}
        <code>model_routes</code>.
      </div>
    </div>
  )
}
