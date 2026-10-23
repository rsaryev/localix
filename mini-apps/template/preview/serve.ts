import { Hono } from 'hono'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTE_PATH, createRoutes } from '../backend/index'

// The preview runs the SAME router as the mini app, on loopback only, over a data folder of its
// own (never the app's). Vite proxies its fixed path; no application credentials or sessions are
// fabricated.
const dataDir = fileURLToPath(new URL('../.preview-data', import.meta.url))
mkdirSync(dataDir, { recursive: true })
const app = new Hono().route(ROUTE_PATH, createRoutes(dataDir))
const port = process.argv.includes('--preview') ? 4175 : 5175
const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: app.fetch })
console.log(`Template backend ready on http://127.0.0.1:${port}`)
const vite = join(dirname(Bun.resolveSync('vite/package.json', import.meta.dir)), 'bin', 'vite.js')
let child: ReturnType<typeof Bun.spawn> | undefined
const stop = () => {
  child?.kill()
  void server.stop(true)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
try {
  child = Bun.spawn(
    [
      process.execPath,
      vite,
      ...(process.argv.includes('--preview') ? ['preview'] : []),
      '--host',
      '127.0.0.1',
    ],
    {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    },
  )
  process.exitCode = await child.exited
} finally {
  await server.stop(true)
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
