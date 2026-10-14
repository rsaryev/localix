/**
 * `POST /rpc/preview/resolve`, driven through Hono's own `app.request()`.
 *
 * The first claim is that the pane gets a CURRENT address for whatever it remembers — the
 * proxy port for an external server, the re-served url for a static file — since a stored
 * ephemeral port is exactly what went dead. The second claim worth pinning is the ERROR SHAPE, and it needs its own test: the hook test on the UI side
 * stubs `fetch` with a body it writes itself, so it agrees with whatever shape the client expects and
 * can never notice the server sending a different one. This route answered a flat
 * `{error: '<reason>'}` while `apps/ui`'s `unwrap()` reads `error.error.message` — so the precise
 * reason became "Request failed with status 404" before any component saw it.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { disposeProxyServers } from '../agent-core/tools/preview/preview-proxy'
import { disposeStaticServers } from '../agent-core/tools/preview/preview-static'
import { createPreviewRoutes, type PreviewRoutesDeps } from './routes'

afterAll(() => {
  disposeProxyServers()
  disposeStaticServers()
})

const deps: PreviewRoutesDeps = {
  openPreview: async () => {
    throw new Error('not reached by these tests')
  },
}

const resolve = (body: unknown) =>
  createPreviewRoutes(deps).request('/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('a file that cannot be served', () => {
  test('answers the app envelope, with the reason inside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'localix-preview-'))
    const res = await resolve({
      url: 'http://localhost:1/index.html',
      rootDir: dir,
      servedFile: 'index.html',
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    expect(body.error?.code).toBe('not_found')
    // The exact read `apps/ui` performs. A flat `{error: string}` leaves this undefined.
    expect(body.error?.message).toContain('No such file to serve')
    expect(body.error?.message).toContain('index.html')
    expect(typeof body.error).not.toBe('string')
  })

  test('a traversal attempt is refused the same way, not with a different shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'localix-preview-'))
    const res = await resolve({
      url: 'http://localhost:1/',
      rootDir: dir,
      servedFile: '../../etc/passwd',
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('not_found')
  })
})

describe('an external server', () => {
  test('answers with a proxy bound by this process, and the url untouched', async () => {
    const res = await resolve({ url: 'http://localhost:8000/game?x=1' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url?: string; previewId?: string; injectUrl?: string }
    expect(body.url).toBe('http://localhost:8000/game?x=1')
    expect(body.previewId).toBe('http://localhost:8000')
    expect(body.injectUrl).toMatch(/^http:\/\/localhost:\d+\/game\?x=1$/)
    // Idempotent within one process: the pane re-asking after a reconnect lands on the same port.
    const again = (await (await resolve({ url: 'http://localhost:8000/' })).json()) as {
      injectUrl?: string
    }
    expect(new URL(again.injectUrl!).port).toBe(new URL(body.injectUrl!).port)
  })

  test('refuses what cannot be framed, in the envelope', async () => {
    const res = await resolve({ url: 'file:///tmp/index.html' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('invalid_url')
  })
})

describe('a servable file', () => {
  test('serves it and returns the URL', async () => {
    // Positive control: without it, the two checks above would also pass on a route that 404s
    // unconditionally.
    const dir = await mkdtemp(join(tmpdir(), 'localix-preview-'))
    await writeFile(join(dir, 'index.html'), '<!doctype html>')
    const res = await resolve({
      url: 'http://localhost:1/index.html',
      rootDir: dir,
      servedFile: 'index.html',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url?: string; previewId?: string }
    expect(body.url).toContain('index.html')
    expect(body.previewId).toContain('http://localhost:')
  })
})

describe('a refused open', () => {
  test('carries the core sentence in the app envelope, not a flat {ok:false}', async () => {
    const refusing: PreviewRoutesDeps = {
      openPreview: async () => ({ ok: false, content: 'No such file to preview: /x/index.html' }),
    }
    const res = await createPreviewRoutes(refusing).request('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', url: '/x/index.html' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string; message?: string }; ok?: boolean }
    expect(body.error?.code).toBe('preview_refused')
    // The exact read `apps/ui`'s `unwrap()` performs; the flat shape left it undefined and the
    // plugin's Preview button reported nothing.
    expect(body.error?.message).toContain('No such file to preview')
    expect(body).not.toHaveProperty('ok')
  })
})

describe('a malformed request', () => {
  test('gets the same envelope as every other failure', async () => {
    const res = await resolve({ rootDir: '/tmp' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code?: string }; success?: boolean }
    expect(body.error?.code).toBe('validation_error')
    // The raw safeParse shape must never reach the wire.
    expect(body).not.toHaveProperty('success')
  })
})
