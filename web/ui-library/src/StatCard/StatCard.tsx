import type { ReactNode } from 'react'

import styles from './StatCard.module.css'

export type StatTone = 'default' | 'success' | 'warning' | 'danger'

export interface StatCardProps {
  label: string
  value: string | number
  hint?: string
  tone?: StatTone
  icon?: ReactNode
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: StatCardProps) {
  return (
    <article className={[styles.card, styles[tone]].join(' ')}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon !== undefined ? <span className={styles.icon}>{icon}</span> : null}
      </div>
      <strong className={styles.value}>{value}</strong>
      {hint !== undefined ? <span className={styles.hint}>{hint}</span> : null}
    </article>
  )
}
