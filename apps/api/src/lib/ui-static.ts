import { join } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import { isPathBelow, resolveWithin } from '@localixai/path-containment'

/**
 * The file under `uiRoot` a request path names, or null when it must fall back to index.html.
 *
 * The router hands over a DECODED path, so `%5C` arrives as `\` — a separator on Windows, where
 * `..\` would step out of the UI root. A backslash or NUL never names a built asset, so either is
 * refused outright; anything else must resolve strictly below the root.
 */
export function resolveUiAsset(uiRoot: string, requestPath: string): string | null {
  if (requestPath.includes('\\') || requestPath.includes('\0')) return null
  const resolved = resolveWithin(uiRoot, `.${requestPath}`)
  return resolved && isPathBelow(uiRoot, resolved) ? resolved : null
}

/** Serve the built UI from `uiRoot`, falling back to index.html for client-side routes. */
export function createUiStaticHandler(uiRoot: string): MiddlewareHandler {
  return async (c) => {
    const reqPath = c.req.path === '/' ? '/index.html' : c.req.path
    const asset = resolveUiAsset(uiRoot, reqPath)
    const requested = asset ? Bun.file(asset) : null
    // SPA fallback — let the client-side router handle unknown paths.
    const file =
      requested && (await requested.exists()) ? requested : Bun.file(join(uiRoot, 'index.html'))
    // Set Content-Type explicitly: Bun infers it lazily on `new Response(file)`,
    // but the upstream cors() middleware clones the response and drops that lazy
    // header, leaving assets (JS/CSS) typeless — which makes the browser refuse to
    // execute the module script and renders a blank page.
    return new Response(file, { headers: { 'Content-Type': file.type } })
  }
}
