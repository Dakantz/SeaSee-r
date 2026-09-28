import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  resolve: {
    alias: [
      { find: /^three$/, replacement: path.resolve(__dirname, 'node_modules/three') }
    ],
    dedupe: ['three']
  },
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



