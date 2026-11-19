import type { ReactNode } from 'react'

import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import { NavLink, useLocation } from 'react-router-dom'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

export interface SidebarNavProps {
  items: NavItem[]
}

export function SidebarNav({ items }: SidebarNavProps) {
  const location = useLocation()

  const isActive = (item: NavItem): boolean =>
    item.end === true
      ? location.pathname === item.to
      : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)

  return (
    <List disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {items.map((item) => (
        <ListItemButton
          component={NavLink}
          key={item.to}
          selected={isActive(item)}
          sx={{
            borderRadius: 2.5,
            color: 'text.secondary',
            py: 1,
            '&.Mui-selected': {
              bgcolor: 'rgba(79, 124, 255, 0.14)',
              color: 'primary.light',
            },
          }}
          to={item.to}
        >
          <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>{item.icon}</ListItemIcon>
          <ListItemText
            primary={item.label}
            slotProps={{ primary: { fontSize: 14, fontWeight: 500 } }}
          />
        </ListItemButton>
      ))}
    </List>
  )
}
