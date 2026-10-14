import { beforeAll, describe, expect, test } from 'bun:test'

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  injectProbeIntoHtml,
  buildInjectedPreviewUrl,
  forwardProxyHeaders,
  ensureStaticServer,
  disposePreviewServers,
  getPreviewProbeJs,
  resolveProbeEntry,
  resolvePrebuiltProbeFile,
} from './preview-probe'

const PROBE = 'data-vf-probe'

// Probe-injection assertions below depend on the REAL probe build. `injectProbeIntoHtml`
// never breaks a preview on a build failure (production degrades to probe-less HTML), so
// a broken test environment used to fail these as a mysterious missing-PROBE flake.
// Await the build up front so the real resolve/build error surfaces instead.
beforeAll(async () => {
  await getPreviewProbeJs()
})

describe('resolveProbeEntry (src → dist fallback)', () => {
  test('prefers the package probe-entry export (TS source) when it resolves', () => {
    const entry = resolveProbeEntry((s) => {
      if (s === '@localixai/visual-feedback/probe-entry') return '/pkg/src/probe/entry.ts'
      throw new Error('unexpected specifier: ' + s)
    })
    expect(entry).toBe('/pkg/src/probe/entry.ts')
  })

  test('falls back to the compiled dist entry when src is not shipped (published install)', () => {
    // A dist-only install resolves the public export and has no source sibling.
    const pkg = mkdtempSync(path.join(tmpdir(), 'vf-dist-'))
    mkdirSync(path.join(pkg, 'dist', 'probe'), { recursive: true })
    writeFileSync(path.join(pkg, 'dist', 'probe', 'entry.js'), '// compiled probe entry')
    const entry = resolveProbeEntry((s) => {
      if (s === '@localixai/visual-feedback/probe-entry')
        return path.join(pkg, 'dist', 'probe', 'entry.js')
      throw new Error(`Cannot find module '${s}'`)
    })
    expect(entry).toBe(path.join(pkg, 'dist', 'probe', 'entry.js'))
  })

  test('rethrows the ORIGINAL resolve error when neither src nor dist exists (stays loud)', () => {
    const pkg = mkdtempSync(path.join(tmpdir(), 'vf-empty-'))
    expect(() =>
      resolveProbeEntry((s) => {
        if (s === '@localixai/visual-feedback') return path.join(pkg, 'dist', 'index.js')
        throw new Error(`Cannot find module '${s}'`)
      }),
    ).toThrow("Cannot find module '@localixai/visual-feedback/probe-entry'")
  })

  test('the REAL workspace resolution prefers live source over the compiled export', () => {
    const entry = resolveProbeEntry()
    expect(entry).toEndWith(path.join('src', 'probe', 'entry.ts'))
  })
})

describe('resolvePrebuiltProbeFile', () => {
  test('selects only the packaged sibling asset', () => {
    expect(
      resolvePrebuiltProbeFile('/pkg/server', (file) => file.endsWith('visual-feedback-probe.js')),
    ).toBe(path.join('/pkg/server', 'visual-feedback-probe.js'))
    expect(resolvePrebuiltProbeFile('/pkg/server', () => false)).toBeNull()
  })
})

describe('disposePreviewServers', () => {
  test('stops cached servers, is idempotent, and a fresh ensure serves again', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-dispose-'))
    writeFileSync(path.join(dir, 'x.html'), '<h1>x</h1>')
    const port = ensureStaticServer(dir)
    expect((await fetch(`http://localhost:${port}/x.html`)).status).toBe(200)
    disposePreviewServers()
    disposePreviewServers() // idempotent — second call must not throw
    const port2 = ensureStaticServer(dir)
    expect((await fetch(`http://localhost:${port2}/x.html`)).status).toBe(200)
    disposePreviewServers()
  })
})

describe('forwardProxyHeaders', () => {
  test('preserves multiple Set-Cookie headers individually', () => {
    const up = new Headers()
    up.append('set-cookie', 'session=abc; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; HttpOnly')
    up.append('set-cookie', 'csrf=xyz; Path=/')
    const cookies = forwardProxyHeaders(up).getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('session=abc')
    expect(cookies[1]).toContain('csrf=xyz')
  })

  test('drops hop-by-hop + frame-blocking headers, keeps the rest', () => {
    const up = new Headers({
      'content-encoding': 'gzip',
      'content-length': '1234',
      connection: 'keep-alive',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
      'content-type': 'text/html',
      'cache-control': 'no-cache',
    })
    const out = forwardProxyHeaders(up)
    expect(out.has('content-encoding')).toBe(false) // fetch already decoded the body
    expect(out.has('content-length')).toBe(false)
    expect(out.has('connection')).toBe(false)
    expect(out.has('content-security-policy')).toBe(false) // would block the inline probe
    expect(out.has('x-frame-options')).toBe(false) // would block iframing
    expect(out.get('content-type')).toBe('text/html')
    expect(out.get('cache-control')).toBe('no-cache')
  })
})

describe('injectProbeIntoHtml placement', () => {
  test('injects before the FIRST </head>', async () => {
    const html = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>'
    const out = await injectProbeIntoHtml(html)
    const probeAt = out.indexOf(PROBE)
    const headEnd = out.indexOf('</head>')
    expect(probeAt).toBeGreaterThan(-1)
    expect(probeAt).toBeLessThan(headEnd) // before </head>
    expect(out).toContain('<body>hi</body>') // body untouched
  })

  test('falls back to before </body> when there is no head', async () => {
    const out = await injectProbeIntoHtml('<body><h1>2048</h1></body>')
    expect(out.indexOf(PROBE)).toBeLessThan(out.indexOf('</body>'))
  })

  test('appends (never prepends before the doctype) for bare fragments', async () => {
    const out = await injectProbeIntoHtml('<h1>2048</h1>')
    expect(out.startsWith('<h1>2048</h1>')).toBe(true)
    expect(out).toContain(PROBE)
  })

  test('stamps the served file when given', async () => {
    const out = await injectProbeIntoHtml('<head></head>', { servedFile: 'game.html' })
    expect(out).toContain('data-vf-file="game.html"')
  })
})

describe('buildInjectedPreviewUrl protocol guard', () => {
  test('returns undefined for non-http(s) and malformed URLs (no bogus proxy)', () => {
    expect(buildInjectedPreviewUrl('file:///tmp/game.html')).toBeUndefined()
    expect(buildInjectedPreviewUrl('data:text/html,<h1>hi</h1>')).toBeUndefined()
    expect(buildInjectedPreviewUrl('not a url')).toBeUndefined()
  })

  test('preserves path + query when proxying an http URL', () => {
    const proxied = buildInjectedPreviewUrl('http://localhost:65000/app/page?q=1')!
    const u = new URL(proxied)
    expect(u.hostname).toBe('localhost')
    expect(u.pathname).toBe('/app/page')
    expect(u.search).toBe('?q=1')
  })
})

describe('injecting proxy', () => {
  test('follows upstream redirects internally + injects the final HTML (stays on proxy)', async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        if (u.pathname === '/start') {
          return new Response(null, { status: 302, headers: { location: `${u.origin}/dest` } })
        }
        return new Response('<html><head></head><body>dest</body></html>', {
          headers: { 'content-type': 'text/html' },
        })
      },
    })
    try {
      const proxied = buildInjectedPreviewUrl(`http://localhost:${upstream.port}/start`)!
      const res = await fetch(proxied, { redirect: 'manual' })
      expect(res.status).toBe(200) // redirect consumed by the proxy, not surfaced
      const body = await res.text()
      expect(body).toContain('<body>dest</body>') // served the final page
      expect(body).toContain(PROBE) // with the probe injected
    } finally {
      await upstream.stop(true)
    }
  })

  test('strips CSP + X-Frame-Options so the iframe renders and the inline probe runs', async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch() {
        return new Response('<html><head></head><body>app</body></html>', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "script-src 'self'",
            'x-frame-options': 'DENY',
          },
        })
      },
    })
    try {
      const proxied = buildInjectedPreviewUrl(`http://localhost:${upstream.port}/`)!
      const res = await fetch(proxied)
      expect(res.headers.get('content-security-policy')).toBeNull()
      expect(res.headers.get('x-frame-options')).toBeNull()
      expect(await res.text()).toContain(PROBE) // probe still injected
    } finally {
      await upstream.stop(true)
    }
  })
})
