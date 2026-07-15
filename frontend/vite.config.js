import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Lokhand Log',
        short_name: 'Lokhand',
        description: 'Self-hosted fitness log',
        theme_color: '#14171c',
        background_color: '#14171c',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      }
    })
  ],
  server: {
    // Override to point a dev/screenshot frontend at a throwaway backend.
    proxy: { '/api': process.env.VITE_API_TARGET || 'http://localhost:8000' }
  }
})
