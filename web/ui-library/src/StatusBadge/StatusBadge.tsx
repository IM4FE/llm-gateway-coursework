import type { ReactNode } from 'react'

import styles from './StatusBadge.module.css'

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusBadgeProps {
  tone?: StatusTone
  dot?: boolean
  children: ReactNode
}

export function StatusBadge({
  tone = 'neutral',
  dot = true,
  children,
}: StatusBadgeProps) {
  return (
    <span className={[styles.badge, styles[tone]].join(' ')}>
      {dot ? <span aria-hidden="true" className={styles.dot} /> : null}
      {children}
    </span>
  )
}
