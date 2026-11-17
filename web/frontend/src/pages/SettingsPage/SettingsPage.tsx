import { Button, Card, PageHeader, StatusBadge } from '@llm-gateway/ui'

import { useAdminAuth } from '../../auth/useAdminAuth'

function maskToken(token: string | null): string {
  if (token === null) {
    return '—'
  }

  if (token.length <= 8) {
    return '••••••••'
  }

  return `${token.slice(0, 4)}••••${token.slice(-4)}`
}

export function SettingsPage() {
  const { token, signOut } = useAdminAuth()

  return (
    <div className="page">
      <PageHeader
        actions={
          <Button onClick={signOut} variant="danger">
            Выйти из админки
          </Button>
        }
        description="Защищённый раздел. В демо-версии токен хранится в sessionStorage и не проверяется backend."
        eyebrow="Admin"
        title="Настройки"
      />

      <div className="page-grid">
        <Card title="Сессия">
          <dl className="detail-list">
            <dt>Статус</dt>
            <dd>
              <StatusBadge tone="success">authenticated</StatusBadge>
            </dd>
            <dt>Admin token</dt>
            <dd className="mono">{maskToken(token)}</dd>
            <dt>Хранилище</dt>
            <dd className="mono">sessionStorage</dd>
          </dl>
        </Card>

        <Card title="Что появится дальше">
          <ul className="feature-list">
            <li>CRUD провайдеров, моделей и alias-маршрутов.</li>
            <li>Управление API-ключами и ручной сброс circuit breaker.</li>
            <li>Лимиты клиентов и просмотр журнала аудита.</li>
          </ul>
        </Card>
      </div>

      <div className="alert alert-info">
        Защищённый маршрут <code>/settings</code> реализован через{' '}
        <code>RequireAdmin</code>. При отсутствии сессии пользователь
        перенаправляется на <code>/login?redirect=...</code>.
      </div>
    </div>
  )
}
