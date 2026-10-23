/**
 * The plumbing every `/rpc/api` call shares: the typed failure, the response reader, and the
 * scoped URL builder.
 *
 * Its own module because the client is now two of them — requests and environments — and both need
 * all of this. Left in either one, the other would import a sibling for its helpers, which is the
 * arrangement that makes a "shared" helper quietly belong to whichever file happened to hold it.
 */

import type { RestErrorCode } from '../backend/contracts'

/** A typed failure, so a caller can branch on `code` rather than parse a message. */
export class RestApiError extends Error {
  readonly code?: RestErrorCode
  readonly detail?: string
  constructor(message: string, code?: RestErrorCode, detail?: string) {
    super(message)
    this.name = 'RestApiError'
    this.code = code
    this.detail = detail
  }
}

/**
 * A 200 carrying `{ error }` is a failure too — the mini app error body is
 * `{ error, code, detail }`, which is NOT core's `{ error: { code, message } }` envelope, so core's
 * `unwrap` cannot read it.
 */
export async function readOr<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: RestErrorCode; detail?: string })
    | null
  if (!res.ok || (json && typeof json.error === 'string')) {
    throw new RestApiError(
      json?.error ?? `Request failed (${res.status})`,
      json?.code,
      json?.detail,
    )
  }
  return json as T
}

export const enc = encodeURIComponent

/**
 * WHICH PROJECT this call is about — named by the caller, never looked up.
 *
 * A collection is a directory inside the project, so every route needs to know which one — and
 * the mini app's backend is wired ONCE, so it cannot know. The host resolves the scope per request
 * (`MiniAppRouteScope`), from the session named here; without it every call would read the
 * collection under the API process's own working directory, which is the repo the app was
 * launched from rather than the one the user is looking at.
 *
 * The session used to be read from the host's ACTIVE chat at call time. A workspace kept mounted
 * for chat A then saved, sent and listed against whichever chat was on screen — chat B's project.
 * Every surface of this mini app belongs to one chat (its tab's session, a file editor's or a
 * status item's `sessionId`), so the caller passes that one and the builder requires it.
 */
function scopedPath(sessionId: string, path: string): string {
  const route = `/rpc/api${path}`
  return `${route}${route.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(sessionId)}`
}

/** Tagged-template sugar bound to one chat: `` u(sessionId)`/requests/${enc(name)}` ``. */
export function u(sessionId: string) {
  return (strings: TemplateStringsArray, ...values: string[]): string =>
    scopedPath(
      sessionId,
      strings.reduce((out, part, i) => out + part + (values[i] ?? ''), ''),
    )
}
