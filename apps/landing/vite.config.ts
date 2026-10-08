import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

import { stageThirdPartyNotices } from '../../scripts/stage-third-party-notices.mjs'

// Landing site for localix.ai — a separate Vite app that reuses the chat
// workspace's design tokens and shared primitives (single source of truth) so
// the marketing surface and the product never drift apart.
export default defineConfig({
  // 5173 (Vite's classic port) — NOT 5060/5061, which Chrome blocks as unsafe
  // (SIP) with ERR_UNSAFE_PORT.
  server: { port: 5173 },
  preview: { port: 5174 },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'landing-font-preloads',
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          if (!context.server) return html
          // Vite's CSS serves workspace fonts through /@fs in dev. Reuse that
          // exact URL so the preload is consumed rather than fetched twice.
          const modules = path.resolve(__dirname, '../../node_modules')
          return html.replaceAll('../../node_modules/', `/@fs/${modules}/`)
        },
      },
    },
    {
      name: 'stage-third-party-notices',
      closeBundle() {
        stageThirdPartyNotices({
          repoRoot: path.resolve(__dirname, '../..'),
          destination: path.resolve(__dirname, 'dist'),
          target: 'landing',
        })
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Single source of truth: pull the product's design tokens + shared
      // primitives straight from apps/ui instead of duplicating them.
      '@ui': path.resolve(__dirname, '../ui/src'),
    },
  },
})
