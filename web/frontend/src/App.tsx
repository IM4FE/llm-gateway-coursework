import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import { AdminAuthProvider } from './auth/AdminAuthProvider'
import { routes } from './router/routes'

const router = createBrowserRouter(routes)

export function App() {
  return (
    <AdminAuthProvider>
      <RouterProvider router={router} />
    </AdminAuthProvider>
  )
}

export default App
