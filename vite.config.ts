import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Server-only keys for the dev proxies. No VITE_ prefix, so never in the bundle (R15).
  const env = loadEnv(mode, process.cwd(), '')
  return {
  server: {
    proxy: {
      // npm run dev:server runs the API on 8787
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/proxy/openrouter': {
        target: 'https://openrouter.ai/api/v1',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/proxy\/openrouter/, ''),
        // Never forward the app's session cookie to a third party
        configure: (proxy) => { proxy.on('proxyReq', (req) => req.removeHeader('cookie')) },
        headers: env.OPENROUTER_API_KEY ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } : {},
      },
      '/proxy/golfcourse': {
        target: 'https://api.golfcourseapi.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/proxy\/golfcourse/, ''),
        // Never forward the app's session cookie to a third party
        configure: (proxy) => { proxy.on('proxyReq', (req) => req.removeHeader('cookie')) },
        headers: env.GOLF_COURSE_API_KEY ? { Authorization: `Key ${env.GOLF_COURSE_API_KEY}` } : {},
      },
    },
  },
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
        // API calls and the sign-in link must reach the network, not the app shell
        navigateFallbackDenylist: [/^\/api\//, /^\/proxy\//],
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
    exclude: ['.agents/**', '.claude/**', 'dist/**', 'releases/**', 'node_modules/**'],
  },
  }
})
