import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/potree-core/dist/workers/*',
          dest: 'potree/workers'
        }
      ]
    })
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    },
    watch: {
      ignored: ['**/public/potree/**', '**/node_modules/**']
    }
  }
})



