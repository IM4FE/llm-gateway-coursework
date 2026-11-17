import type { ReactNode } from 'react'

import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span aria-hidden="true" className={styles.icon}>
        ∅
      </span>
      <h3 className={styles.title}>{title}</h3>
      {description !== undefined ? (
        <p className={styles.description}>{description}</p>
      ) : null}
      {action !== undefined ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
