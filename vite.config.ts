import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Golf Bender App',
        short_name: 'Golf Bender',
        description: 'Golf Bender Tournament Scoring',
        theme_color: '#030712',
        background_color: '#030712',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Take control immediately on update — no need to close all tabs
        skipWaiting: true,
        clientsClaim: true,
        // Runtime cache for images with 6h TTL so logo/icon updates propagate quickly
        runtimeCaching: [
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|ico|webp)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: {
                maxAgeSeconds: 6 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
  },
})
