import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom'

import { StatusBadge } from '@llm-gateway/ui'

import { useAdminAuth } from '../../auth/useAdminAuth'
import { SidebarNav } from '../SidebarNav/SidebarNav'

import type { NavItem } from '../SidebarNav/SidebarNav'

const DRAWER_WIDTH = 264

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Обзор', icon: <DashboardOutlinedIcon fontSize="small" />, end: true },
  { to: '/providers', label: 'Провайдеры', icon: <DnsOutlinedIcon fontSize="small" /> },
  { to: '/models', label: 'Маршруты', icon: <SwapHorizOutlinedIcon fontSize="small" /> },
  { to: '/requests', label: 'Запросы', icon: <ReceiptLongOutlinedIcon fontSize="small" /> },
  { to: '/playground', label: 'Песочница', icon: <PlayCircleOutlineIcon fontSize="small" /> },
  { to: '/settings', label: 'Настройки', icon: <SettingsOutlinedIcon fontSize="small" /> },
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
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box component="nav" sx={{ flexShrink: 0, width: DRAWER_WIDTH }}>
        <Drawer
          slotProps={{
            paper: {
              sx: {
                bgcolor: 'rgba(7, 11, 22, 0.92)',
                borderRight: 1,
                borderColor: 'divider',
                width: DRAWER_WIDTH,
              },
            },
          }}
          variant="permanent"
        >
          <Stack gap={3.5} sx={{ height: '100%', p: 2.25 }}>
            <Stack alignItems="center" direction="row" gap={1.5} px={0.75} py={0.5}>
              <Box
                sx={{
                  alignItems: 'center',
                  background: 'linear-gradient(135deg, #4f7cff, #22d3ee)',
                  borderRadius: 2.5,
                  color: '#04122f',
                  display: 'flex',
                  fontSize: 12,
                  fontWeight: 800,
                  height: 38,
                  justifyContent: 'center',
                  letterSpacing: '0.04em',
                  width: 38,
                }}
              >
                LG
              </Box>
              <Box>
                <Typography fontWeight={700} variant="subtitle2">
                  LLM Gateway
                </Typography>
                <Typography
                  color="text.secondary"
                  fontSize={11}
                  letterSpacing="0.08em"
                  textTransform="uppercase"
                >
                  admin console
                </Typography>
              </Box>
            </Stack>

            <Box aria-label="Основная навигация" component="nav" sx={{ flexGrow: 1 }}>
              <SidebarNav items={NAV_ITEMS} />
            </Box>

            <Stack alignItems="flex-start" gap={1.25} px={0.75}>
              <StatusBadge tone={isAuthenticated ? 'success' : 'neutral'}>
                {isAuthenticated ? 'admin session' : 'guest mode'}
              </StatusBadge>
              <Typography color="text.secondary" variant="caption">
                v0.1 · MUI
              </Typography>
            </Stack>
          </Stack>
        </Drawer>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <AppBar
          color="transparent"
          elevation={0}
          position="sticky"
          sx={{
            backdropFilter: 'blur(14px)',
            bgcolor: 'rgba(7, 11, 22, 0.78)',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ gap: 2, justifyContent: 'space-between', minHeight: 72 }}>
            <Box>
              <Typography
                color="text.secondary"
                fontSize={10}
                fontWeight={700}
                letterSpacing="0.14em"
                textTransform="uppercase"
              >
                LLM Gateway
              </Typography>
              <Typography fontWeight={700}>{current?.label ?? 'Console'}</Typography>
            </Box>
            <Stack alignItems="center" direction="row" gap={2}>
              <Link component={RouterLink} to="/playground" underline="hover" variant="body2">
                Песочница
              </Link>
              {isAuthenticated ? (
                <Button color="inherit" onClick={signOut} size="small">
                  Выйти
                </Button>
              ) : (
                <Link component={RouterLink} to="/login" underline="hover" variant="body2">
                  Admin login
                </Link>
              )}
            </Stack>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flexGrow: 1 }}>
          <Box sx={{ mx: 'auto', maxWidth: 1400, p: { xs: 2, md: 4 }, width: '100%' }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
