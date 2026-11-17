import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { StatusBadge } from '@llm-gateway/ui'

import { useAdminAuth } from '../../auth/useAdminAuth'
import { SidebarNav } from '../SidebarNav/SidebarNav'

import type { NavItem } from '../SidebarNav/SidebarNav'

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Обзор', icon: '◈', end: true },
  { to: '/providers', label: 'Провайдеры', icon: '⬡' },
  { to: '/models', label: 'Маршруты', icon: '⇄' },
  { to: '/requests', label: 'Запросы', icon: '☰' },
  { to: '/playground', label: 'Playground', icon: '▷' },
  { to: '/settings', label: 'Настройки', icon: '⚙' },
]

export function AppLayout() {
  const { isAuthenticated, signOut } = useAdminAuth()
  const location = useLocation()
  const current = NAV_ITEMS.find((item) =>
    item.to === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.to),
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span aria-hidden="true" className="brand-mark">
            LG
          </span>
          <div>
            <strong className="brand-title">LLM Gateway</strong>
            <span className="brand-subtitle">admin console</span>
          </div>
        </div>

        <SidebarNav items={NAV_ITEMS} />

        <div className="sidebar-footer">
          <StatusBadge tone={isAuthenticated ? 'success' : 'neutral'}>
            {isAuthenticated ? 'admin session' : 'guest mode'}
          </StatusBadge>
          <span className="muted">v0.1 · mock UI</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-kicker">LLM Gateway</span>
            <strong>{current?.label ?? 'Console'}</strong>
          </div>
          <div className="topbar-actions">
            <NavLink className="link" to="/playground">
              Playground
            </NavLink>
            {isAuthenticated ? (
              <button className="link-button" onClick={signOut} type="button">
                Выйти
              </button>
            ) : (
              <NavLink className="link" to="/login">
                Admin login
              </NavLink>
            )}
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
