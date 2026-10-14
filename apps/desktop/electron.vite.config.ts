import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@textpro/core', '@textpro/platform-win'] })],
    resolve: {
      alias: {
        '@textpro/core': resolve('../../packages/core/src/index.ts'),
        '@textpro/platform-win': resolve('../../packages/platform-win/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@textpro/core'] })],
    resolve: {
      alias: {
        '@textpro/core': resolve('../../packages/core/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@textpro/core': resolve('../../packages/core/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          palette: resolve(__dirname, 'src/renderer/palette.html'),
          manager: resolve(__dirname, 'src/renderer/manager.html'),
          prompt: resolve(__dirname, 'src/renderer/prompt.html'),
        },
      },
    },
    plugins: [react()],
  },
})
