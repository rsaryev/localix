import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isFrameBlocked, localFileRefPath } from './open-preview-detect'
import { openPreviewCore, previewTabId, type OpenPreviewCoreOptions } from './open-preview'
import { ensureStaticServer, getPreviewProbeJs } from './preview-probe'

// The AUTO-SERVES test asserts the visual-feedback probe is injected into served HTML.
// `injectProbeIntoHtml` deliberately never breaks a preview on a probe build failure —
// in production it degrades to probe-less HTML with a console warning. Under test that
// degradation is a TRAP: a broken environment (visual-feedback source/dist unresolvable,
// deps not installed) used to surface as a mysterious `data-vf-probe` assertion flake
// with zero causal information. Await the real build here so a broken env fails LOUDLY
// with the actual resolve/build error instead.
beforeAll(async () => {
  await getPreviewProbeJs()
})

const headers = (h: Record<string, string>) => new Headers(h)

describe('localFileRefPath', () => {
  test('decodes a file URL the way the platform does', () => {
    expect(localFileRefPath('file:///work/my%20page.html')).toBe('/work/my page.html')
    expect(localFileRefPath('FILE:///work/a.html')).toBe('/work/a.html')
    expect(localFileRefPath(' /work/a.html ')).toBe('/work/a.html')
  })

  test('a file URL with a host keeps the relative strip it always had', () => {
    expect(localFileRefPath('file://./site/index.html')).toBe('./site/index.html')
  })
})

describe('isFrameBlocked (iframeable vs "can\'t embed" card)', () => {
  test('any X-Frame-Options value blocks (DENY / SAMEORIGIN / ALLOW-FROM)', () => {
    expect(isFrameBlocked(headers({ 'x-frame-options': 'DENY' }))).toBe(true)
    expect(isFrameBlocked(headers({ 'x-frame-options': 'SAMEORIGIN' }))).toBe(true)
    expect(isFrameBlocked(headers({ 'x-frame-options': 'ALLOW-FROM https://example.com' }))).toBe(
      true,
    )
  })

  test('CSP frame-ancestors excluding us blocks', () => {
    expect(isFrameBlocked(headers({ 'content-security-policy': "frame-ancestors 'self'" }))).toBe(
      true,
    )
    expect(isFrameBlocked(headers({ 'content-security-policy': "frame-ancestors 'none'" }))).toBe(
      true,
    )
    expect(
      isFrameBlocked(
        headers({ 'content-security-policy': 'frame-ancestors https://app.example.com' }),
      ),
    ).toBe(true)
  })

  test('CSP frame-ancestors allowing wildcard/localhost does not block', () => {
    expect(isFrameBlocked(headers({ 'content-security-policy': 'frame-ancestors *' }))).toBe(false)
    expect(
      isFrameBlocked(
        headers({ 'content-security-policy': 'frame-ancestors http://localhost:5050' }),
      ),
    ).toBe(false)
  })

  test('a page with no framing headers is embeddable', () => {
    expect(isFrameBlocked(headers({ 'content-type': 'text/html' }))).toBe(false)
    expect(isFrameBlocked(headers({ 'content-security-policy': "default-src 'self'" }))).toBe(false)
  })
})

function makeCore(sessionId = 'preview-test', defaultCwd?: string) {
  const events: any[] = []
  const streamRegistry = {
    publish: (_userId: string, _sessionId: string, event: unknown) => {
      events.push(event)
    },
  }
  const options: OpenPreviewCoreOptions = {
    userId: 'u1',
    sessionId,
    streamRegistry: streamRegistry as never,
    defaultCwd,
  }
  return { options, events, sessionId }
}

/**
 * `browser {action:'open'}` starts a real HTTP server rooted at the DIRECTORY of the path it is
 * given, and `preview-static.ts`'s traversal guard confines requests to that root — the wrong boundary
 * when the root itself comes from the model. `isLocalFileRef` accepts `../…`, `path.resolve` absorbs
 * it, and there is no `browser` case in `permission-facts.ts`, so no prompt or user rule could
 * intercept it either.
 */
describe('a file outside the workspace is refused, not served', () => {
  test('a relative static root resolves from the session workspace', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'preview-root-'))
    mkdirSync(path.join(workspace, 'dist'))
    writeFileSync(path.join(workspace, 'dist', 'index.html'), '<h1>root</h1>')
    const { options } = makeCore('relative-root', workspace)
    const result = await openPreviewCore(options, { file_path: 'dist/index.html', root: 'dist' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rootDir).toBe(path.join(workspace, 'dist'))
    const outsideRoot = await openPreviewCore(options, { file_path: 'dist/index.html', root: '..' })
    expect(outsideRoot.ok).toBe(false)
    expect(outsideRoot.content).toContain('root must stay inside')
  })
  test('a ../ escape from the session cwd is refused with the resolved path named', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'preview-outside-'))
    writeFileSync(path.join(outside, 'id_rsa'), 'PRIVATE KEY')
    const workspace = mkdtempSync(path.join(tmpdir(), 'preview-ws-'))
    const { options } = makeCore('escape', workspace)

    const rel = path.relative(workspace, path.join(outside, 'id_rsa'))
    const result = await openPreviewCore(options, { file_path: rel })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.content).toContain('outside this session')
  })

  test('an ABSOLUTE path outside the workspace is refused too', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'preview-outside-abs-'))
    writeFileSync(path.join(outside, 'secret.html'), '<h1>x</h1>')
    const workspace = mkdtempSync(path.join(tmpdir(), 'preview-ws-abs-'))
    const { options } = makeCore('escape-abs', workspace)

    const result = await openPreviewCore(options, {
      file_path: path.join(outside, 'secret.html'),
    })
    expect(result.ok).toBe(false)
  })

  test('a path INSIDE the workspace still serves — the guard is containment, not a ban', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'preview-ws-ok-'))
    const nested = path.join(workspace, 'dist')
    mkdirSync(nested, { recursive: true })
    writeFileSync(path.join(nested, 'index.html'), '<h1>ok</h1>')
    const { options } = makeCore('inside', workspace)

    expect((await openPreviewCore(options, { file_path: 'dist/index.html' })).ok).toBe(true)
  })

  test('with NO workspace root an absolute path is still allowed — the editor Preview button', async () => {
    // The UI sends an already-resolved absolute path chosen by the USER and binds no cwd. There is
    // nothing to contain against, and refusing here would break that button.
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-nocwd-'))
    writeFileSync(path.join(dir, 'page.html'), '<h1>ok</h1>')
    const { options } = makeCore('no-cwd', undefined)
    expect((await openPreviewCore(options, { file_path: path.join(dir, 'page.html') })).ok).toBe(
      true,
    )
  })
})

describe('the static preview server binds loopback only', () => {
  test('it still serves over loopback, and still refuses a traversal', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-bind-'))
    writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>')
    const port = ensureStaticServer(dir)
    expect((await fetch(`http://127.0.0.1:${port}/index.html`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${port}/../../etc/passwd`)).status).not.toBe(200)
  })

  test.each(['preview-static.ts', 'preview-proxy.ts'])('%s pins the bind address', (file) => {
    // A SOURCE assertion, because a loopback fetch cannot discriminate: `0.0.0.0` answers on
    // 127.0.0.1 too, so the test above passes either way and would be dishonest as a binding proof.
    // What regresses here is a DELETED LINE — `Bun.serve`'s `hostname` defaults to `0.0.0.0`, which
    // exposed the served directory (and the proxied dev server) to the whole LAN for the process
    // lifetime — so reading the file is the guard that actually catches it.
    const src = readFileSync(path.join(import.meta.dir, file), 'utf8')
    expect(src).toContain("hostname: '127.0.0.1'")
  })
})

describe('openPreviewCore only opens normal iframe previews', () => {
  test('a local file we serve opens as a normal (non-browser-backed) preview', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-'))
    writeFileSync(path.join(dir, 'app.html'), '<h1>local</h1>')
    const { options } = makeCore('sup', dir)
    const result = await openPreviewCore(options, { url: 'app.html' })
    expect(result.ok).toBe(true)
  })
})

describe('openPreviewCore', () => {
  // A real reachable server: the core probes the URL for liveness, so the
  // publish/dedup tests need something actually listening.
  let server: { stop: () => void; port: number }
  let origin: string
  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: () => new Response('ok') }) as never
    origin = `http://localhost:${server.port}`
  })
  afterAll(() => server.stop())

  test('publishes a preview.updated event with an opaque tab ID and resolved url', async () => {
    const { options, events, sessionId } = makeCore()
    const result = await openPreviewCore(options, { url: `${origin}/dashboard`, title: 'My App' })

    expect(result.ok).toBe(true)
    expect(events).toHaveLength(1)
    const publishedId = events[0].previewId
    expect(events[0]).toMatchObject({
      type: 'preview.updated',
      sessionId,
      previewId: expect.any(String),
      url: `${origin}/dashboard`,
      title: 'My App',
      viewport: null,
    })
    expect(typeof events[0].version).toBe('number')
    if (result.ok) {
      expect(result.previewId).toBe(publishedId)
      expect(result.previewId).not.toBe(origin)
      expect(result.url).toBe(`${origin}/dashboard`)
    }
  })

  test('derives the title from host:port when none is given', async () => {
    const { options, events } = makeCore()
    await openPreviewCore(options, { url: origin })
    expect(events[0].title).toBe(`localhost:${server.port}`)
  })

  test('keeps an explicitly requested fixed viewport instead of the Responsive default', async () => {
    const { options, events } = makeCore()
    const viewport = { width: 375, height: 667 }
    const result = await openPreviewCore(options, { url: origin, viewport })
    expect(events[0].viewport).toEqual(viewport)
    if (result.ok) expect(result.viewport).toEqual(viewport)
  })

  test('opens a remote native Browser tab without a server-side fetch or iframe classification', async () => {
    const { options, events } = makeCore()
    const result = await openPreviewCore(options, { url: 'https://github.com/' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.frameBlocked).toBe(false)
      expect(result.injectUrl).toBeUndefined()
      expect(result.content).toContain('Browser tab')
    }
    expect(events[0].url).toBe('https://github.com/')
  })

  test('the same origin lands in the same derived tab, and a later call bumps the version', async () => {
    const { options, events } = makeCore()
    await openPreviewCore(options, {
      url: `${origin}/`,
      viewport: { width: 375, height: 667 },
    })
    await openPreviewCore(options, { url: `${origin}/iframe.html` })

    expect(events).toHaveLength(2)
    // Derived from the session and the target, not remembered: a restart cannot fork it.
    expect(events[0].previewId).toBe(previewTabId(options.userId, options.sessionId, origin))
    expect(events[1].previewId).toBe(events[0].previewId)
    expect(events[1].version).toBeGreaterThan(events[0].version)
    expect(events[0].viewport).toEqual({ width: 375, height: 667 })
    expect(events[1].viewport).toBeNull()
  })

  test('a local address that does not answer is opened all the same', async () => {
    const { options, events } = makeCore()
    // a port nothing is listening on: the page shows what it returns
    const result = await openPreviewCore(options, { url: 'http://localhost:9' })
    expect(result.ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].frameBlocked).toBeFalsy()
  })

  test('rejects a non-http(s) protocol', async () => {
    const { options, events } = makeCore()
    // no file extension, so the local-file heuristic doesn't claim it first
    const result = await openPreviewCore(options, { url: 'ftp://example.com/files' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.content).toContain('Unsupported protocol')
    expect(events).toHaveLength(0)
  })

  test('an absolute path with NO cwd bound still auto-resolves (missing file → clear error)', async () => {
    const { options, events } = makeCore()
    const result = await openPreviewCore(options, { url: 'file:///work/sess/game2048.html' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.content).toContain('No such file to preview')
    expect(events).toHaveLength(0)
  })

  test('a file:// URL is decoded, not regex-stripped (percent-escapes name the real file)', async () => {
    const { options } = makeCore()
    const result = await openPreviewCore(options, { url: 'file:///work/my%20page.html' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.content).toContain('No such file to preview: /work/my page.html')
  })

  test('rejects an unparseable url', async () => {
    const { options, events } = makeCore()
    const result = await openPreviewCore(options, { url: 'not a url' })
    expect(result.ok).toBe(false)
    expect(events).toHaveLength(0)
  })

  test('an empty input is rejected with the "provide url" guidance', async () => {
    const { options } = makeCore()
    const result = await openPreviewCore(options, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.content).toContain('Provide `url`')
  })

  test('a RELATIVE path with no cwd gives an actionable serve-first hint (dir + file)', async () => {
    const { options } = makeCore()
    const result = await openPreviewCore(options, { url: 'work/sess/game2048.html' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.content).toContain('python3 -m http.server')
      expect(result.content).toContain('--directory work/sess')
      expect(result.content).toContain('game2048.html')
    }
  })

  test('a bare file path (not a URL) is treated as a static file to serve, not "invalid"', async () => {
    const { options } = makeCore()
    const result = await openPreviewCore(options, { url: '/work/sess/index.html' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.content).toContain('No such file to preview')
      expect(result.content).not.toContain('Invalid URL')
    }
  })

  test('AUTO-SERVES a local file when a workspace cwd is set, and serves it over http', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-'))
    writeFileSync(path.join(dir, 'game.html'), '<h1>2048</h1>')
    const { options, events } = makeCore('preview-auto', dir)

    // model passes just the filename — no manual server start
    const result = await openPreviewCore(options, { url: 'game.html' })
    expect(result.ok).toBe(true)
    expect(events).toHaveLength(1)
    const url: string = events[0].url
    expect(url).toMatch(/^http:\/\/localhost:\d+\/game\.html$/)
    if (result.ok) expect(result.autoServed).toBe(true)

    // the spun-up static server actually serves the file — with the visual-feedback
    // probe injected for HTML (inert until the host activates it).
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<h1>2048</h1>')
    expect(body).toContain('data-vf-probe')
    expect(body).toContain('data-vf-file="game.html"')

    // a path-traversal attempt is refused
    const fileOrigin = new URL(url).origin
    const bad = await fetch(`${fileOrigin}/../../etc/passwd`)
    expect([403, 404]).toContain(bad.status)
  })

  test('accepts `file_path` as an alias for `url` (toolset-consistent param)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-'))
    writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>')
    const { options, events } = makeCore('preview-alias', dir)

    // model reaches for `file_path` (like read/write/edit) instead of `url`
    const result = await openPreviewCore(options, { file_path: 'index.html' })
    expect(result.ok).toBe(true)
    expect(events[0].url).toMatch(/^http:\/\/localhost:\d+\/index\.html$/)
  })

  test('reports a missing file instead of serving a 404 preview', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-'))
    const { options } = makeCore('preview-missing', dir)
    const result = await openPreviewCore(options, { url: 'nope.html' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.content).toContain('No such file')
  })
})

describe('the session scratch directory is a second host-chosen root', () => {
  test('a page written to the scratch dir opens, as the prompt promises', async () => {
    // The system prompt sends every throwaway render target there ("Tools/plugins that render
    // from a file keep theirs in a subfolder here") and this tool refused exactly that
    // directory — a narrow-viewport page written there could not be opened.
    const workspace = mkdtempSync(path.join(tmpdir(), 'preview-ws-scratch-'))
    const scratch = mkdtempSync(path.join(tmpdir(), 'preview-scratch-'))
    writeFileSync(path.join(scratch, 'narrow.html'), '<h1>narrow</h1>')
    const { options } = makeCore('scratch-ok', workspace)

    const result = await openPreviewCore(
      { ...options, scratchDir: scratch },
      { file_path: path.join(scratch, 'narrow.html') },
    )
    expect(result.ok).toBe(true)
  })

  test('it widens nothing else: an escape is still refused, and named', async () => {
    // The containment exists because the served ROOT was model-chosen. A scratch dir is not:
    // the host derives it from the session id, so allowing it adds no directory the model can
    // name. Anywhere else stays refused.
    const workspace = mkdtempSync(path.join(tmpdir(), 'preview-ws-scratch2-'))
    const scratch = mkdtempSync(path.join(tmpdir(), 'preview-scratch2-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'preview-outside-scratch-'))
    writeFileSync(path.join(outside, 'id_rsa'), 'PRIVATE KEY')
    const { options } = makeCore('scratch-guard', workspace)

    const result = await openPreviewCore(
      { ...options, scratchDir: scratch },
      { file_path: path.join(outside, 'id_rsa') },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a refusal')
    // Both roots are named, so the reader knows where the file may go instead.
    expect(result.content).toContain(workspace)
    expect(result.content).toContain(scratch)
  })
})
