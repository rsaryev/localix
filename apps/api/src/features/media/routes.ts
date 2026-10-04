import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { defaultErrorHandler, jsonError } from '../../lib/http'
import { mediaTypeForName, type MediaStore } from './store'

/**
 * Serves stored media files by content id and accepts direct uploads. Generated
 * and uploaded media bytes live on the filesystem (see `media/store.ts`); an
 * attachment carries `mediaId`, and the UI loads the bytes from `GET
 * /rpc/media/:id` instead of inlining base64. The id is content-addressed +
 * format-validated (`isMediaId`) so the serve route can't be coaxed into reading
 * arbitrary paths.
 *
 * `POST /rpc/media?name=<filename>` stores a raw request body and returns its
 * content id — the drag-to-open router uses this to materialize a dropped browser
 * `File` into the store, then opens the matching viewer tab by `mediaId` (so a
 * web drop, which never exposes an absolute path, still reaches the path-agnostic
 * viewers). The stored id's extension follows the FILENAME's known media type
 * (authoritative over the often-blank browser Content-Type), so `mediaId` routing
 * and serving stay correct.
 *
 * Media is immutable + content-addressed, so it's safe to cache aggressively.
 */
export function createMediaRoutes(store: MediaStore) {
  const app = new Hono<AppContext>()

  const routes = app
    .post('/', async (c) => {
      const name = c.req.query('name') ?? 'file'
      const buf = new Uint8Array(await c.req.arrayBuffer())
      // ZERO bytes is a legitimate file (a fresh .log, a touch'd placeholder) — it
      // must OPEN (as empty text), not 400. The old empty_upload guard traded that
      // away to catch lost request bodies; a content-addressed empty blob is
      // harmless, so the trade goes the other way.
      //
      // NO size check here. There used to be one against a 200MB constant, and it could never run:
      // `Bun.serve`'s `maxRequestBodySize` (now stated in `lib/request-limits.ts`) rejects with a 413
      // before this handler is reached, and a chunked body makes the `arrayBuffer()` above throw. A
      // check after the bytes are already buffered cannot bound memory anyway. The 413 carries no
      // body, so the CLIENT owns the explanation — `apps/ui/.../media-client.ts` refuses oversized
      // files up front and names the limit.
      // Filename extension wins (a dropped file's browser Content-Type is often
      // blank/generic); fall back to the request header, then a neutral default.
      const mediaType =
        mediaTypeForName(name) ?? c.req.header('content-type') ?? 'application/octet-stream'
      const { id, size } = await store.putBytes(buf, mediaType, { nameHint: name })
      return c.json({ id, name, size, mediaType })
    })
    .get('/:id', async (c) => {
      const id = c.req.param('id')
      const resolved = await store.resolve(id)
      // The app envelope, not a bare `{error:'media_not_found'}` — `apps/ui`'s `unwrap()` reads
      // `error.error.message`, so a flat body loses the reason and reports only the status.
      if (!resolved) return jsonError(c, 404, 'media_not_found', `No stored media with id "${id}"`)
      return new Response(Bun.file(resolved.filePath), {
        headers: {
          'Content-Type': resolved.mediaType,
          'Content-Length': String(resolved.size),
          // Content-addressed (id = sha256 of bytes) ⇒ immutable; cache forever.
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    })

  routes.onError(defaultErrorHandler)
  return routes
}
