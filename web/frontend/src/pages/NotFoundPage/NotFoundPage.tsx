import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import { Link as RouterLink } from 'react-router-dom'

import { EmptyState, PageHeader } from '@llm-gateway/ui'

export function NotFoundPage() {
  return (
    <Stack gap={3}>
      <PageHeader
        description="Такой страницы нет в структуре роутинга."
        eyebrow="404"
        title="Страница не найдена"
      />

      <EmptyState
        action={
          <Link component={RouterLink} to="/" underline="hover">
            ← На главную
          </Link>
        }
        description="Проверьте адрес или вернитесь на панель управления."
        title="Маршрут не существует"
      />
    </Stack>
  )
}
