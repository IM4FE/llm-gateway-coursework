import { AppLayout } from '../components/AppLayout/AppLayout'
import { RequireAdmin } from '../components/RequireAdmin/RequireAdmin'
import { DashboardPage } from '../pages/DashboardPage/DashboardPage'
import { LoginPage } from '../pages/LoginPage/LoginPage'
import { ModelsPage } from '../pages/ModelsPage/ModelsPage'
import { NotFoundPage } from '../pages/NotFoundPage/NotFoundPage'
import { PlaygroundPage } from '../pages/PlaygroundPage/PlaygroundPage'
import { ProviderDetailsPage } from '../pages/ProviderDetailsPage/ProviderDetailsPage'
import { ProvidersPage } from '../pages/ProvidersPage/ProvidersPage'
import { RequestDetailsPage } from '../pages/RequestDetailsPage/RequestDetailsPage'
import { RequestsPage } from '../pages/RequestsPage/RequestsPage'
import { SettingsPage } from '../pages/SettingsPage/SettingsPage'

import type { RouteObject } from 'react-router-dom'

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: 'providers',
        element: <ProvidersPage />,
      },
      {
        path: 'providers/:providerId',
        element: <ProviderDetailsPage />,
      },
      {
        path: 'models',
        element: <ModelsPage />,
      },
      {
        path: 'requests',
        element: <RequestsPage />,
      },
      {
        path: 'requests/:requestId',
        element: <RequestDetailsPage />,
      },
      {
        path: 'playground',
        element: <PlaygroundPage />,
      },
      {
        path: 'settings',
        element: (
          <RequireAdmin>
            <SettingsPage />
          </RequireAdmin>
        ),
      },
      {
        path: 'login',
        element: <LoginPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]
