import type { ReactNode } from 'react'

import styles from './Card.module.css'

export type CardTone = 'default' | 'muted'

export interface CardProps {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  tone?: CardTone
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  tone = 'default',
}: CardProps) {
  const classes = [styles.card, styles[tone], className].filter(Boolean).join(' ')
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined

  return (
    <section className={classes}>
      {hasHeader ? (
        <header className={styles.header}>
          <div className={styles.heading}>
            {title !== undefined ? <h2 className={styles.title}>{title}</h2> : null}
            {description !== undefined ? (
              <p className={styles.description}>{description}</p>
            ) : null}
          </div>
          {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      ) : null}
      <div className={styles.content}>{children}</div>
    </section>
  )
}
