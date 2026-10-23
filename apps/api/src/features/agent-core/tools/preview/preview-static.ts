// ─── Static file server (for files the agent wrote — `browser action="open" file_path:"index.html"`) ──
//
// One server per directory, reused across calls/sessions so a worker can
// open `game.html` and have it Just Work — no manual `python3 -m http.server`
// dance (the source of most preview retries). HTML responses get the probe injected
// inline (same-origin, no CORS); everything else streams through. Persist for the
// process lifetime; bounded by the number of distinct preview dirs (tiny).

import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { isPathWithin } from '../../../../lib/path-containment'
import { injectProbeIntoHtml } from './probe-inject'
import { rejectForeignHost } from './preview-host-guard'
import { createPreviewServerCache } from './preview-server-cache'

const staticServers = createPreviewServerCache('static')

/** The root's real path, or the lexical one when it cannot be resolved (nothing then serves). */
function realRootOf(root: string): string {
  try {
    return realpathSync(root)
  } catch {
    return root
  }
}

export function ensureStaticServer(dir: string): number {
  const root = path.resolve(dir)
  return staticServers.ensure(dir, () => {
    const realRoot = realRootOf(root)
    return Bun.serve({
      port: 0, // ephemeral — Bun picks a free port
      // LOOPBACK ONLY. `Bun.serve`'s `hostname` defaults to `0.0.0.0` (verified against Bun's docs),
      // so this served the chosen directory to every machine on the network — a coffee-shop LAN could
      // read the user's project over HTTP for as long as the process lived (the cache keeps up to 16
      // of these alive until shutdown). The preview is consumed by an iframe in the user's own client,
      // which reaches it over loopback.
      hostname: '127.0.0.1',
      async fetch(req) {
        const foreign = rejectForeignHost(req)
        if (foreign) return foreign
        const url = new URL(req.url)
        let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
        if (rel === '') rel = 'index.html'
        const abs = path.resolve(root, rel)
        // Path-traversal guard: never serve outside the directory. ROOT-INCLUSIVE
        // (`isPathWithin`) — exactly the rule this hand-rolled `abs !== root ||
        // startsWith(root + sep)` spelled, now taken from its ONE owner. Naming the dir
        // itself stays a 404 from `file.exists()` below, as it always did; tightening to
        // `isPathBelow` would only turn that 404 into a 403 for no gain.
        if (!isPathWithin(root, abs)) {
          return new Response('Forbidden', { status: 403 })
        }
        // ...and by REAL path: the lexical check passes a symlink inside the root that points out
        // of it (a cloned repository can commit `h -> ../../`), and `Bun.file` follows it.
        let real: string
        try {
          real = await realpath(abs)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'ENOTDIR') {
            return new Response('Not found', { status: 404 })
          }
          return new Response('Forbidden', { status: 403 })
        }
        if (!isPathWithin(realRoot, real)) return new Response('Forbidden', { status: 403 })
        const file = Bun.file(real)
        if (!(await file.exists())) return new Response('Not found', { status: 404 })
        if (abs.endsWith('.html') || abs.endsWith('.htm')) {
          const injected = await injectProbeIntoHtml(await file.text(), { servedFile: rel })
          return new Response(injected, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        }
        return new Response(file) // Bun infers content-type from the extension
      },
    })
  })
}

/** Stop every cached static preview server (idempotent). */
export function disposeStaticServers(): void {
  staticServers.dispose()
}
