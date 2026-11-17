import { useState } from 'react'
import type { FormEvent } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
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
    <Box sx={{ display: 'grid', minHeight: 'calc(100vh - 220px)', placeItems: 'center' }}>
      <Stack gap={2.5} sx={{ width: 'min(460px, 100%)' }}>
        <PageHeader
          description="Демонстрационный gate для защищённых страниц консоли."
          eyebrow="Admin"
          title="Вход в админ-консоль"
        />

        <Card>
          <Stack component="form" gap={2} onSubmit={handleSubmit}>
            <TextField
              autoComplete="off"
              fullWidth
              id="admin-token"
              label="Admin token"
              onChange={(event) => setToken(event.target.value)}
              placeholder="любая непустая строка"
              type="password"
              value={token}
            />

            {error !== null ? <Alert severity="error">{error}</Alert> : null}

            <Button fullWidth type="submit">
              Войти
            </Button>
          </Stack>
        </Card>

        <Typography color="text.secondary" sx={{ textAlign: 'center' }} variant="caption">
          В учебном каркасе токен не сверяется с backend: он лишь открывает защищённые маршруты и
          хранится в sessionStorage. Реальная проверка появится вместе с admin API.
        </Typography>
      </Stack>
    </Box>
  )
}
