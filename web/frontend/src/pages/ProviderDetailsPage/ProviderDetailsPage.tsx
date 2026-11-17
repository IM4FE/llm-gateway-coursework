import { Link, useParams } from 'react-router-dom'

import { Card, EmptyState, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { providers } from '../../data/mockData'
import { providerStatusLabel, providerStatusTone } from '../../lib/format'

export function ProviderDetailsPage() {
  const { providerId } = useParams<{ providerId: string }>()
  const provider = providers.find((item) => item.id === providerId)

  if (provider === undefined) {
    return (
      <div className="page">
        <EmptyState
          action={
            <Link className="link" to="/providers">
              ← К списку провайдеров
            </Link>
          }
          description={`Провайдер с id «${providerId ?? '—'}» не найден в mock-данных.`}
          title="Провайдер не найден"
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link className="link" to="/providers">
          Провайдеры
        </Link>
        <span>/</span>
        <span>{provider.name}</span>
      </div>

      <PageHeader
        actions={
          <StatusBadge tone={providerStatusTone(provider.status)}>
            {providerStatusLabel(provider.status)}
          </StatusBadge>
        }
        description={provider.description}
        eyebrow="Provider"
        title={provider.name}
      />

      <div className="page-grid">
        <Card title="Подключение">
          <dl className="detail-list">
            <dt>ID</dt>
            <dd className="mono">{provider.id}</dd>
            <dt>Base URL</dt>
            <dd className="mono">{provider.baseUrl}</dd>
            <dt>Модели</dt>
            <dd>{provider.models}</dd>
            <dt>Ключи</dt>
            <dd>{provider.keys}</dd>
            <dt>Средний latency</dt>
            <dd className="mono">{provider.latencyMs} ms</dd>
          </dl>
        </Card>

        <Card
          description="Значения ниже — демонстрационные."
          title="Состояние ключей"
        >
          <div className="stack">
            <div className="key-row">
              <StatusBadge tone="success">active</StatusBadge>
              <span className="mono">...6937</span>
              <span className="muted">failure_count = 0</span>
            </div>
            <div className="key-row">
              <StatusBadge tone="warning">cooldown</StatusBadge>
              <span className="mono">...41af</span>
              <span className="muted">failure_count = 3</span>
            </div>
            <div className="key-row">
              <StatusBadge tone="neutral">disabled</StatusBadge>
              <span className="mono">...0c2d</span>
              <span className="muted">is_active = false</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="alert alert-info">
        Детальная страница использует параметр маршрута{' '}
        <code>providerId</code>. Реальные ключи и их состояние будут загружаться
        из admin API; сейчас это заглушка.
      </div>
    </div>
  )
}
