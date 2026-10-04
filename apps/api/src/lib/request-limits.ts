/**
 * Serve-level request limits — declared HERE rather than inherited from the runtime.
 *
 * WHY THIS FILE EXISTS. `Bun.serve` was called with no `maxRequestBodySize`, so the effective cap was
 * Bun's default of 128MB. Nothing in this repo said so, and three things went wrong because of it:
 *
 *  1. The media route carried `MAX_UPLOAD_BYTES = 200_000_000` with the comment "Large enough for a
 *     dropped video, small enough to bound abuse". That check could never run: Bun rejects at 128MB
 *     first. Measured both paths — a `Content-Length` body over the cap gets a 413 and the handler is
 *     NEVER reached, and a chunked body reaches the handler but `arrayBuffer()` throws
 *     "Request body exceeded maxRequestBodySize" while Bun has already answered 413.
 *  2. Either way the 413 carries an EMPTY body and no content-type (measured), so no server-side
 *     message can reach the user. The client has to own the explanation.
 *  3. An inherited default is a silent contract: a Bun upgrade could move it and no test here would
 *     notice, because no test could name the number.
 *
 * The value keeps today's EFFECTIVE behaviour exactly — it is Bun's current default, now stated
 * explicitly instead of assumed. Raising it is a deliberate choice, not a side effect of an upgrade,
 * and it widens what every endpoint will buffer, so it belongs in a commit that says so.
 */

/**
 * Largest request body any endpoint will accept, in bytes (128 MiB).
 *
 * Enforced ONCE, at the serve layer, where Bun can reject on `Content-Length` before buffering
 * anything. A per-route byte check after `await c.req.arrayBuffer()` cannot bound memory — the bytes
 * are already in it.
 */
export const MAX_REQUEST_BODY_BYTES = 128 * 1024 * 1024

/** `128 MB` — for a message a user can act on, since the 413 itself carries no body. */
export function formatByteLimit(bytes: number = MAX_REQUEST_BODY_BYTES): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}
