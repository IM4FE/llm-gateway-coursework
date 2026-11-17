import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ['src'],
      outDirs: ['dist'],
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'LlmGatewayUi',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^react(\/.*)?$/,
        /^react-dom(\/.*)?$/,
        /^@mui\/material(\/.*)?$/,
        /^@mui\/icons-material(\/.*)?$/,
        /^@emotion\/react(\/.*)?$/,
        /^@emotion\/styled(\/.*)?$/,
      ],
    },
  },
})
