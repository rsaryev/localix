import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { captureRoot, fixtureFile, verifyDemoRuntime } from './runtime.mjs'

const identityPath = '/localix-capture-service.json'

/** Serve only public demo responses. Reuse a server only when it proves the same fixture root. */
export async function ensureFixtureService({ root, directory = captureRoot, port = 5160 }) {
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(directory)])
  if (!realRoot.startsWith(`${realDirectory}${path.sep}`))
    throw new Error('The HTTP fixture must be inside the isolated capture directory.')
  const identity = {
    service: 'localix-screenshot-fixture',
    version: 1,
    rootId: createHash('sha256').update(realRoot).digest('hex'),
  }
  // The same marker identifies the optional nginx container mounted on this fixture directory.
  await fs.writeFile(path.join(realRoot, identityPath.slice(1)), JSON.stringify(identity))
  let existing
  if (port) {
    try {
      existing = await fetch(`http://127.0.0.1:${port}${identityPath}`, {
        signal: AbortSignal.timeout(1000),
      })
    } catch (error) {
      if (error.name === 'TimeoutError')
        throw new Error(`Port ${port} is occupied by an unresponsive service; leave it running.`)
      // Connection refusal means there is no fixture service to reuse.
      if (error.cause?.code !== 'ECONNREFUSED' && error.code !== 'ConnectionRefused') throw error
    }
    if (existing) {
      let value
      try {
        value = await existing.json()
      } catch {
        /* Unidentified service. */
      }
      if (
        !existing.ok ||
        value?.service !== identity.service ||
        value?.version !== identity.version ||
        value?.rootId !== identity.rootId
      )
        throw new Error(`Port ${port} belongs to another service; refusing to reuse or stop it.`)
      return { origin: `http://127.0.0.1:${port}`, owned: false, stop: () => {} }
    }
  }
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/release-status.json', ['release-status.json', 'application/json']],
  ])
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405 })
      const pathname = new URL(request.url).pathname
      if (pathname === identityPath) return Response.json(identity)
      const file = files.get(pathname)
      if (!file) return new Response('Not found', { status: 404 })
      const body = Bun.file(path.join(realRoot, file[0]))
      if (!(await body.exists())) return new Response('Fixture not seeded', { status: 404 })
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'content-type': file[1], 'cache-control': 'no-store' },
      })
    },
  })
  return {
    origin: `http://127.0.0.1:${server.port}`,
    owned: true,
    stop: () => server.stop(true),
  }
}

if (import.meta.main) {
  await verifyDemoRuntime()
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const service = await ensureFixtureService({ root: fixture.root })
  console.log(`${service.owned ? 'Started' : 'Reusing'} demo HTTP fixture at ${service.origin}`)
  if (service.owned) {
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        service.stop()
        process.exit(0)
      })
  }
}
