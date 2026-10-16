import type { Context } from 'hono'

import type { Logger } from './logger'

/**
 * One id per request, on the response (`x-request-id`) and on every log line about it.
 *
 * THE DEFECT. An Event Center row said "Docker returned an error." and the API log said
 * `GET /rpc/<plugin>/containers 400` — two records of one failure with nothing joining them, and the
 * log line had no error code, no detail, nothing. A plugin route answers its typed error body
 * itself, so the root error handler never saw it and nothing was logged at all. Now the id joins
 * the row to the log, and a rejected answer's own `{ code, error, detail }` is written beside it.
 *
 * A WeakMap keyed by the Request rather than a context variable: the context type is the plugin
 * SDK's public `HostRouteContext`, and a host-only bookkeeping field does not belong in it.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

const ids = new WeakMap<Request, string>()

export function assignRequestId(c: Context): string {
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  ids.set(c.req.raw, id)
  c.header(REQUEST_ID_HEADER, id)
  return id
}

export function requestIdOf(c: Context): string | undefined {
  return ids.get(c.req.raw)
}

/** Response headers can be immutable (a proxied fetch); the id is then simply not echoed. */
export function stampRequestId(c: Context, id: string): void {
  try {
    c.res.headers.set(REQUEST_ID_HEADER, id)
  } catch {
    // Immutable headers — the log line still carries the id.
  }
}

const DETAIL_MAX = 2_000
const BODY_MAX_BYTES = 64 * 1024

export interface RejectionFacts {
  code?: string
  message?: string
  detail?: string
}

function text(value: unknown, max = DETAIL_MAX): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined
}

/**
 * The error a failed JSON answer carried — both envelopes the routes use: the host's nested
 * `{ error: { code, message, detail } }` and a plugin's flat `{ error, code, detail }`. Read from a
 * CLONE, bounded, and only for JSON: a stream or a file download is never buffered for a log line.
 */
export async function rejectionFacts(response: Response): Promise<RejectionFacts | null> {
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return null
  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > BODY_MAX_BYTES) return null
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const outer = body as Record<string, unknown>
  const nested =
    outer.error && typeof outer.error === 'object' ? (outer.error as Record<string, unknown>) : null
  const facts: RejectionFacts = {
    code: text(outer.code, 120) ?? text(nested?.code, 120),
    message: text(outer.error, 500) ?? text(nested?.message, 500),
    detail: text(outer.detail) ?? text(nested?.detail),
  }
  return facts.code || facts.message || facts.detail ? facts : null
}

/**
 * The access line for every request, plus — for a rejected JSON answer — its own error beside the
 * id, at `warn` for a client fault and `error` for a server one.
 */
export async function logCompletedRequest(
  c: Context,
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
  line: { status: number } & Record<string, unknown>,
): Promise<void> {
  logger.info({ event: 'request.completed', ...line })
  if (line.status < 400) return
  const facts = await rejectionFacts(c.res)
  if (!facts) return
  if (line.status >= 500) logger.error({ event: 'request.rejected', ...line, ...facts })
  else logger.warn({ event: 'request.rejected', ...line, ...facts })
}
