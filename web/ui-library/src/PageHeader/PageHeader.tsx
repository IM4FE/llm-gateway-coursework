import type { ReactNode } from 'react'

import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {eyebrow !== undefined ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h1 className={styles.title}>{title}</h1>
        {description !== undefined ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}
