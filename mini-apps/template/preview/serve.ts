import { Hono } from 'hono'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'
import { testMiniAppContext } from '@localixai/mini-app-sdk/backend/testing'
import { register } from '../backend/index'

// The preview runs the SAME backend as the mini app — `register(ctx)` — on loopback only, over a
// data folder of its own (never the app's). Vite proxies its path; no application credentials or
// sessions are fabricated, so a chat collection answers "Open this in a chat." here.
const dataDir = fileURLToPath(new URL('../.preview-data', import.meta.url))
mkdirSync(dataDir, { recursive: true })
const ctx = Object.assign(await testMiniAppContext({ name: 'template' }), { dataDir })
const mount = [register(ctx).backend ?? []].flat()[0]?.routeMount
if (!mount) throw new Error('The backend registered no routes.')
const scope: MiniAppRouteScope = { userId: 'preview', projectId: '', cwd: dataDir }
const app = new Hono().route(mount.path, mount.app)
const port = process.argv.includes('--preview') ? 4175 : 5175
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: (request) => app.fetch(request, scope),
})
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
