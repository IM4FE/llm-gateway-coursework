import { Link } from 'react-router-dom'

import { Button, Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { providers } from '../../data/mockData'
import { providerStatusLabel, providerStatusTone } from '../../lib/format'

export function ProvidersPage() {
  return (
    <div className="page">
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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Провайдер</th>
                <th scope="col">Статус</th>
                <th scope="col">Модели</th>
                <th scope="col">Ключи</th>
                <th scope="col">Latency</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <Link className="link" to={`/providers/${provider.id}`}>
                      {provider.name}
                    </Link>
                    <div className="mono muted">{provider.baseUrl}</div>
                  </td>
                  <td>
                    <StatusBadge tone={providerStatusTone(provider.status)}>
                      {providerStatusLabel(provider.status)}
                    </StatusBadge>
                  </td>
                  <td>{provider.models}</td>
                  <td>{provider.keys}</td>
                  <td className="mono">{provider.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="alert alert-info">
        Это каркас админ-консоли: список читается из mock-данных. Создание,
        редактирование и удаление провайдеров появятся после добавления
        admin API в backend.
      </div>
    </div>
  )
}
