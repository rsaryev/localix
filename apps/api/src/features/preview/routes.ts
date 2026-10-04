import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'
import path from 'node:path'
import type { AppContext } from '../../app'
import { defaultErrorHandler, jsonError } from '../../lib/http'
import { confineToDir } from '../ext/fs-discovery'
import { ensureStaticServer } from '../agent-core/tools/preview/preview-probe'
import { buildInjectedPreviewUrl } from '../agent-core/tools/preview/preview-proxy'
import type { OpenPreviewCoreResult } from '../agent-core/tools/preview/open-preview'

const resolveSchema = z.object({
  /** The preview's url as the pane remembers it. */
  url: z.string().min(1),
  /** Auto-served static file: the directory the agent served (the entry's `rootDir`). */
  rootDir: z.string().min(1).optional(),
  /** ...and the file within it (the entry's `servedFile`). */
  servedFile: z.string().min(1).optional(),
})

/** What a preview pane may point its frame at RIGHT NOW. */
export interface ResolvedPreviewEndpoint {
  /** The page url. For a static file this is the freshly (re-)served one. */
  url: string
  previewId: string
  /**
   * The probe-injecting proxy in front of an external server, bound by THIS process. Absent
   * for a static file (its server injects the probe itself).
   */
  injectUrl?: string
}

const openSchema = z.object({
  /** The chat session whose preview panel should open (events route per-session). */
  sessionId: z.string().min(1),
  /** A running dev-server URL (e.g. the one a background job advertised) — or a
   *  local file path, which the core auto-serves from a static server. */
  url: z.string().min(1),
  /** For a file inside a static site: the directory to serve, so links and assets resolve. */
  root: z.string().min(1).optional(),
})

export type OpenPreviewInput = z.infer<typeof openSchema>

/** Open a live preview for a URL on behalf of the UI — same path the agent's
 *  `browser` tool uses (injecting proxy + `preview.updated` → auto-reveal), bound
 *  by the host so this route never imports the chat runtime. */
export interface PreviewRoutesDeps {
  openPreview: (userId: string, input: OpenPreviewInput) => Promise<OpenPreviewCoreResult>
}

/**
 * REST surface of the in-process preview servers.
 *
 * Both servers a preview may load through — the static file server and the probe-injecting
 * proxy — are `Bun.serve` on an EPHEMERAL port held in a process-local map. They die with the
 * process: a dev `bun --watch` reload, a crash, a machine sleep that bounced the API. A pane
 * that had persisted one of those ports came back to a dead address, and because the app it
 * fronted (say `localhost:8000`) was still up, liveness said "running" and the pane showed a
 * white frame with nothing to explain it.
 *
 * `resolve` is the fix: the pane never trusts a stored port. Before it mounts a frame (and
 * again after a reconnect, which is how it learns the API restarted) it asks this process
 * where the page is served from NOW. Same process → the cached server and the same port
 * (idempotent); a new process → a fresh one, started on demand.
 */
export function createPreviewRoutes(deps: PreviewRoutesDeps) {
  const app = new Hono<AppContext>()

  const routes = app
    .post('/resolve', zValidator('json', resolveSchema), async (c) => {
      const { url, rootDir, servedFile } = c.req.valid('json')
      if (rootDir && servedFile) {
        const dir = path.resolve(rootDir)
        // The served file must resolve inside the served directory (no traversal) and exist.
        const abs = confineToDir(dir, servedFile)
        if (!abs || !(await Bun.file(abs).exists())) {
          // The app envelope: `apps/ui`'s `unwrap()` reads `error.error.message`, so a flat body
          // turned this precise reason into "Request failed with status 404" and the Preview panel
          // had nothing to show.
          return jsonError(c, 404, 'not_found', `No such file to serve: ${servedFile} in ${dir}`)
        }
        const port = ensureStaticServer(dir)
        const resolved: ResolvedPreviewEndpoint = {
          url: `http://localhost:${port}/${encodeURIComponent(servedFile)}`,
          previewId: `http://localhost:${port}`,
        }
        return c.json(resolved, 200)
      }
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return jsonError(c, 400, 'invalid_url', `Not a url: ${url}`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return jsonError(c, 400, 'invalid_url', `Only http(s) previews can be framed: ${url}`)
      }
      const resolved: ResolvedPreviewEndpoint = {
        url: parsed.href,
        previewId: parsed.origin,
        injectUrl: buildInjectedPreviewUrl(parsed.href),
      }
      return c.json(resolved, 200)
    })
    // Open (or reload) a live preview for a URL — used by the background-jobs strip's
    // "Open preview" action to (re)attach the preview of a dev server a job advertised,
    // even after the user closed the tab. Publishes `preview.updated` → the UI reveals.
    .post('/open', zValidator('json', openSchema), async (c) => {
      const result = await deps.openPreview(c.get('userId'), c.req.valid('json'))
      // The core's refusal is a sentence for the model. Sent flat as `{ok:false, content}` it was
      // invisible to the UI: `unwrap()` reads the app envelope, so a plugin's "Preview" button got
      // a 400 with no message and reported nothing at all. The envelope is what every other route
      // speaks, and `content` is already the sentence a person can act on.
      if (!result.ok) return jsonError(c, 400, 'preview_refused', result.content)
      return c.json(result, 200)
    })

  routes.onError(defaultErrorHandler)
  return routes
}
