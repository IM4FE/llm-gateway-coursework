import { useState } from 'react'
import type { FormEvent } from 'react'

import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Card, PageHeader } from '@llm-gateway/ui'

import { useAdminAuth } from '../../auth/useAdminAuth'

export function LoginPage() {
  const { isAuthenticated, signIn } = useAdminAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const redirect = searchParams.get('redirect') ?? '/settings'

  if (isAuthenticated) {
    return <Navigate replace to={redirect} />
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const normalized = token.trim()

    if (normalized === '') {
      setError('Введите admin token.')

      return
    }

    signIn(normalized)
    navigate(redirect, { replace: true })
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <PageHeader
          description="Демонстрационный gate для защищённых страниц консоли."
          eyebrow="Admin"
          title="Вход в админ-консоль"
        />

        <Card>
          <form className="form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="admin-token">Admin token</label>
              <input
                autoComplete="off"
                className="input"
                id="admin-token"
                onChange={(event) => setToken(event.target.value)}
                placeholder="любая непустая строка"
                type="password"
                value={token}
              />
            </div>

            {error !== null ? (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            ) : null}

            <Button fullWidth type="submit">
              Войти
            </Button>
          </form>
        </Card>

        <p className="muted login-hint">
          В учебном каркасе токен не сверяется с backend: он лишь открывает
          защищённые маршруты и хранится в sessionStorage. Реальная проверка
          появится вместе с admin API.
        </p>
      </div>
    </div>
  )
}
