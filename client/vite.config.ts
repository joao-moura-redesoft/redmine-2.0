import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Use our custom sw.ts so the notificationclick handler runs
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      // O bundle passou de 2 MiB (default do Workbox) e o build falhava. É um app
      // exe-local servido pelo loopback, então precachear alguns MB não custa banda.
      injectManifest: { maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
      manifest: {
        name: 'Bluemine',
        short_name: 'Bluemine',
        description: 'Kanban e gestão de tarefas do Redmine',
        theme_color: '#2563eb',
        background_color: '#f1f5f9',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      // Exclusão de /api/ do SW está em sw.ts via NavigationRoute denylist

      // Habilita o service worker também em `npm run dev` para testar push/notificações
      // (por padrão o vite-plugin-pwa só ativa o SW no build de produção).
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
