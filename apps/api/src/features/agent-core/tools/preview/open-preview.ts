import path from 'node:path'
import { createHash } from 'node:crypto'

import { localixWorkspaceDir } from '../../../../lib/env'
import { isPathWithin } from '../../../../lib/path-containment'
import type { SessionStreamRegistry } from '../../../chat/runtime/session-stream-registry'
import { ensureStaticServer, buildInjectedPreviewUrl } from './preview-probe'
import { isFrameBlocked, isLocalFileRef, localFileRefPath } from './open-preview-detect'

/** Bound-at-wiring context the open-preview core needs (user + session + stream). */
export interface OpenPreviewCoreOptions {
  userId: string
  sessionId: string
  streamRegistry: SessionStreamRegistry
  /** Workspace root, for resolving a static file path to auto-serve. */
  defaultCwd?: string
  /** Server-chosen session scratch root, permitted alongside the workspace for preview files. */
  scratchDir?: string
}

/** Model-supplied input the core accepts (mirrors the old open_preview schema). */
export interface OpenPreviewCoreInput {
  background?: boolean
  viewport?: { width: number; height: number } | null
  url?: string
  file_path?: string
  path?: string
  title?: string
  /** Serve an export root so nested pages resolve links and assets from that root. */
  root?: string
}

export type OpenPreviewCoreResult =
  | {
      ok: true
      url: string
      previewId: string
      title: string
      /** The monotonic version published with the event — a caller opening from a response
       *  records the same entry the stream would, and the two dedupe instead of double-loading. */
      version: number
      servedFile?: string
      rootDir?: string
      injectUrl?: string
      frameBlocked: boolean
      autoServed: boolean
      content: string
      background?: boolean
      viewport?: { width: number; height: number } | null
      /** A local address that did not answer the open-time request (the reason), e.g. a dev
       *  server that stopped. The tab still opens; the caller explains a probe that never came. */
      unreachable?: string
    }
  | { ok: false; content: string }

// Strictly increasing across calls (module-level so it survives across the plain
// function callers `browser` binds — and is globally monotonic across
// sessions, which is fine: it only ever needs to strictly increase so the UI
// reloads on any change). Two calls in the same millisecond still get distinct
// versions.
let lastVersion = 0

/**
 * The tab a target opens in, derived rather than remembered: the same session opening the same
 * dev server (its origin) or the same served folder (not its ephemeral port) lands in the same
 * tab, across restarts, with no table kept anywhere. Opaque, so a URL is never an ID.
 */
export function previewTabId(userId: string, sessionId: string, target: string): string {
  return createHash('sha256')
    .update(`${userId}\0${sessionId}\0${target}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Open a live preview of a running server/app (or a static file we auto-serve) in
 * the browser workspace.
 *
 * Extracted as a pure function (no tool wrapper) so BOTH the `browser`
 * `open` action AND the lazy auto-open path reuse the exact same logic — no
 * duplication.
 */
export async function openPreviewCore(
  options: OpenPreviewCoreOptions,
  input: OpenPreviewCoreInput,
): Promise<OpenPreviewCoreResult> {
  // `url` is canonical; `file_path`/`path` are accepted aliases.
  const requested = (input.url ?? input.file_path ?? input.path ?? '').trim()
  if (!requested) {
    return { ok: false, content: 'Provide `url` (a static file path or an http(s) URL).' }
  }
  let target = requested
  let autoServed = false
  // When we auto-serve a static file, we KNOW its path — the strongest "where
  // to edit" signal for the visual-feedback layer. Carried on preview.updated.
  let servedFile: string | undefined
  let rootDir: string | undefined

  // "preview the .html I wrote" is the most common intent. Rather than make the
  // model start a server by hand (the #1 source of preview retries), auto-serve a
  // local file/path/file:// from a static server we run, then preview that URL.
  if (isLocalFileRef(target)) {
    const filePath = localFileRefPath(target)
    // An absolute path needs no workspace root to resolve against — the UI's
    // editor "Preview" button sends the resolved absolute path with no cwd bound.
    if (options.defaultCwd || path.isAbsolute(filePath)) {
      const abs = path.isAbsolute(filePath) ? filePath : path.resolve(options.defaultCwd!, filePath)
      // CONTAINMENT, and the boundary is the DIRECTORY we are about to serve, not the file.
      //
      // `ensureStaticServer(dirname(abs))` roots a real HTTP server at whatever directory the path
      // lands in, and `preview-static.ts`'s traversal guard confines REQUESTS to that root — which is
      // the wrong boundary when the root itself is attacker-chosen. `isLocalFileRef` accepts anything
      // starting with `/`, `./`, `../` or `file://`, and `path.resolve` silently absorbs `../`, so
      // `browser {action:'open', file_path:'../../../.ssh/id_rsa'}` served `~/.ssh` and
      // returned the key. There is no permission fact for this tool either
      // (`permission-facts.ts` has no `browser` case), so no prompt and no user rule could
      // intercept it.
      //
      // Only when a workspace root EXISTS. With no `defaultCwd` there is nothing to contain against,
      // and that is the editor "Preview" button's path: the UI sends an already-resolved absolute path
      // chosen by the USER, not by the model. Every model-facing run has one — `runtime-tools.ts`
      // requires `defaultCwd: string`.
      // Either HOST-CHOSEN root contains it: the workspace, or this session's scratch dir.
      const roots = [options.defaultCwd, options.scratchDir]
        .filter((dir): dir is string => Boolean(dir))
        .map((dir) => path.resolve(dir))
      if (options.defaultCwd && !roots.some((root) => isPathWithin(root, abs))) {
        return {
          ok: false,
          content:
            `Refusing to preview ${abs}: it is outside this session's workspace ` +
            `(${roots.join(' or ')}). Previewing a file starts a static server rooted at ` +
            `its directory, so the path has to stay inside one of those. Copy the file in, or open a ` +
            `URL instead.`,
        }
      }
      // A requested root has to CONTAIN the file — otherwise `root` would be a second way to
      // choose an arbitrary directory to serve, one the containment check above never saw.
      const root = input.root
        ? path.resolve(options.defaultCwd ?? localixWorkspaceDir(), input.root)
        : undefined
      if (root && options.defaultCwd && !isPathWithin(path.resolve(options.defaultCwd), root)) {
        return { ok: false, content: 'The preview root must stay inside the session workspace.' }
      }
      if (root && !isPathWithin(root, abs)) {
        return {
          ok: false,
          content: `Refusing to preview ${abs}: it is not inside the root ${root}.`,
        }
      }
      const dir = root ?? path.dirname(abs)
      const name = root ? path.relative(root, abs).split(path.sep).join('/') : path.basename(abs)
      if (!(await Bun.file(abs).exists())) {
        return { ok: false, content: `No such file to preview: ${abs}` }
      }
      const port = ensureStaticServer(dir)
      target = `http://localhost:${port}/${name.split('/').map(encodeURIComponent).join('/')}`
      autoServed = true
      servedFile = name
      rootDir = dir
    } else {
      // No workspace root to resolve against → fall back to actionable guidance.
      const slash = filePath.replace(/\\/g, '/').lastIndexOf('/')
      const dir = slash > 0 ? filePath.slice(0, slash) : '.'
      const name = slash >= 0 ? filePath.slice(slash + 1) : filePath
      return {
        ok: false,
        content:
          `Can't preview a static file directly. Start a server FIRST (bash, background:true): ` +
          `\`python3 -m http.server 8000 --directory ${dir}\`  — then call \`Browser\` action="open" with \`http://localhost:8000/${name}\`.`,
      }
    }
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return { ok: false, content: `Invalid URL: ${requested}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      content: `Unsupported protocol "${parsed.protocol}": only http(s) URLs and local files open.`,
    }
  }
  // On Windows the packaged app itself is served at http(s)://tauri.localhost, an origin the API
  // and the desktop shell trust; a browser tab must never load it.
  if (parsed.hostname.replace(/\.$/, '') === 'tauri.localhost') {
    return { ok: false, content: `Refused to open the app's own origin: ${parsed.host}` }
  }

  // A local page is shown in an iframe, so read whether it refuses framing — best effort: an
  // address that does not answer is opened all the same and shows what it returns, and `open`
  // reports whether the page's probe came up. Remote sites are opened by the system WebView
  // itself: a server-side GET can be blocked by bot defenses or TLS configuration even when the
  // page works in a browser, and framing headers do not apply to a native child WebView.
  let frameBlocked = false
  let unreachable: string | undefined
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (!autoServed && localHost) {
    // Follow redirects so we read the FINAL page's headers (e.g. google.com 301s to a consent
    // URL that carries the X-Frame-Options) — `manual` would give an opaque redirect.
    const res = await fetch(parsed.href, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(2500),
    }).catch((error: unknown) => {
      unreachable = describeFetchFailure(error)
      return null
    })
    if (res) {
      frameBlocked = isFrameBlocked(res.headers)
      // This request needs headers only; release streaming/large response bodies.
      void res.body?.cancel().catch(() => {})
    }
  }

  // A served folder is keyed by the folder: its static server's port changes on a restart.
  // Manually opened browser tabs have their own IDs even when they visit the same origin.
  const previewId = previewTabId(
    options.userId,
    options.sessionId,
    autoServed && rootDir ? `folder:${rootDir}` : parsed.origin,
  )
  const url = parsed.href
  const title = input.title ?? parsed.host
  // Monotonic version: a higher value on a later call forces the UI to reload the
  // iframe; an identical value (SSE replay on reconnect) is a no-op. Time-based so
  // it keeps advancing across runs, but floored above the last to stay strictly
  // increasing even for back-to-back calls within the same millisecond.
  const version = Math.max(Date.now(), lastVersion + 1)
  lastVersion = version
  // Opening without a device size means Responsive, including when an existing
  // tab is reopened after a manual fixed-size inspection.
  const viewport = input.viewport ?? null

  // For a local dev server (we don't serve its HTML), expose an on-demand
  // injecting-proxy URL so the user can switch the preview to a probe-enabled
  // variant for commenting — without modifying the project. Static auto-served
  // previews already have the probe inlined, so they don't need this.
  const injectUrl = autoServed || !localHost ? undefined : buildInjectedPreviewUrl(url)

  // Local pages keep the visual-feedback iframe; remote pages use the platform
  // WebView with the same tab ID and agent command contract.
  options.streamRegistry.publish(options.userId, options.sessionId, {
    type: 'preview.updated',
    background: input.background,
    viewport,
    sessionId: options.sessionId,
    previewId,
    url,
    title,
    version,
    ...(servedFile ? { servedFile } : {}),
    ...(rootDir ? { rootDir } : {}),
    // When framing is refused, the UI shows the "can't embed" card (strip-proxy/open-in-browser).
    // The proxy address stays off the wire: it is an ephemeral port of THIS process, and a pane
    // that persisted one came back to a dead port after a restart — it resolves it on mount.
    ...(frameBlocked && injectUrl ? { frameBlocked: true } : {}),
  })

  const content = autoServed
    ? `Serving the file and opened Browser tab: ${url}`
    : frameBlocked
      ? `Opened Browser tab: ${url}. This local site blocks embedding; the desktop app displays it in a system WebView.`
      : `Opened Browser tab: ${url}`

  return {
    ok: true,
    background: input.background,
    viewport,
    url,
    previewId,
    title,
    version,
    servedFile,
    rootDir,
    injectUrl,
    frameBlocked,
    autoServed,
    content,
    ...(unreachable ? { unreachable } : {}),
  }
}

function describeFetchFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ConnectionRefused' || code === 'ECONNREFUSED') return 'connection refused'
  if (error instanceof Error && error.name === 'TimeoutError') return 'no response within 2.5 s'
  return error instanceof Error && error.message ? error.message : 'no response'
}
