import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The standalone preview only. The plugin's Localix artifact is built by the app's own builder
// (`apps/api/src/features/plugins/authoring/ui-build.ts`), never by this config. Keep the create-vite split
// between an HTML dev entry and application source: preview-only providers and styles must
// never become a second app inside Localix.
const hostSrc = fileURLToPath(new URL('../../apps/ui/src', import.meta.url))
const kitDoors = fileURLToPath(new URL('../../packages/kit/src/entries', import.meta.url))

/**
 * `@localixai/kit/<id>` has two providers — a door of the kit package, or a module the host lends
 * (`apps/ui/src/app/kit`) — in that order, the same order as the tsconfig paths. An alias maps to
 * one place only, which is why this is a resolver.
 */
function kitModules(): Plugin {
  return {
    name: 'kit-modules',
    enforce: 'pre',
    resolveId(id) {
      const match = /^@localixai\/kit\/(.+)$/u.exec(id)
      if (!match) return null
      const door = `${kitDoors}/${match[1]}.ts`
      return existsSync(door) ? door : `${hostSrc}/app/kit/${match[1]}.ts`
    },
  }
}

export default defineConfig({
  plugins: [kitModules(), react(), tailwindcss()],
  resolve: {
    alias: [{ find: '@', replacement: hostSrc }],
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5184, strictPort: true, proxy: { '/rpc/motion': 'http://127.0.0.1:5185' } },
  preview: { port: 4184, strictPort: true, proxy: { '/rpc/motion': 'http://127.0.0.1:4185' } },
  build: { outDir: 'dist/preview' },
})
