import { NavLink } from 'react-router-dom'

export interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

export interface SidebarNavProps {
  items: NavItem[]
}

export function SidebarNav({ items }: SidebarNavProps) {
  return (
    <nav aria-label="Основная навигация" className="nav">
      {items.map((item) => (
        <NavLink
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          end={item.end ?? false}
          key={item.to}
          to={item.to}
        >
          <span aria-hidden="true" className="nav-icon">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
