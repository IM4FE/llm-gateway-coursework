import { Link } from 'react-router-dom'

import { EmptyState, PageHeader } from '@llm-gateway/ui'

export function NotFoundPage() {
  return (
    <div className="page">
      <PageHeader
        description="Такой страницы нет в структуре роутинга."
        eyebrow="404"
        title="Страница не найдена"
      />

      <EmptyState
        action={
          <Link className="link" to="/">
            ← На главную
          </Link>
        }
        description="Проверьте адрес или вернитесь на панель управления."
        title="Маршрут не существует"
      />
    </div>
  )
}
