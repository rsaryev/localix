import type { Context } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { isApiError } from './errors'

export type JsonErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503

/**
 * WHERE a mini app route call is happening — resolved by the host PER REQUEST.
 *
 * A mini app backend is loaded once and wired once, so anything it captures at load time is frozen:
 * `ctx.cwd` is the project that happened to be current at boot, and it keeps saying so after the
 * user switches session to another project. A mini app whose state lives in the WORKSPACE (files
 * beside the code they describe, rather than one global pile in `~/.localix`) therefore cannot use
 * it — it would read and write the wrong project's files, silently, and only for the second
 * project onwards.
 *
 * So the scope rides the REQUEST. The host resolves it the same way the rest of the app does —
 * the session's cwd, else the project's, else the process's — and hands it to the mini app's Hono
 * app as its Hono environment.
 */
export interface MiniAppRouteScope {
  /** The resolved host user. */
  userId: string
  /** The chat session the caller named, once the host checked the user owns it. Mini app data may
   *  be session-owned. */
  sessionId?: string
  /** The project this call belongs to, or `''` for the projectless default scope. */
  projectId: string
  /** Absolute working directory for that project — ALWAYS the current one. */
  cwd: string
}

/**
 * Hono environment guaranteed by the host when a contributed router is mounted.
 *
 * The scope arrives as `Bindings` — `c.env.userId`, `c.env.cwd` — and there is deliberately no
 * `Variables`. A contributed app is fetched with the RAW request, so nothing an app-level
 * middleware `set()` reaches it: `c.get('userId')` is `undefined` at runtime, always.
 *
 * It USED to declare `Variables: { userId: string }` "for compatibility", which made that exact
 * mistake type-check. A router moved in from the host kept core's `c.get('userId')` idiom across
 * sixty-odd handlers, compiled clean, and resolved every request as an unknown user — every panel
 * it served reported an empty workspace. A contract that types a value it never delivers is worse
 * than no contract: the compiler vouches for the bug.
 */
export type MiniAppRouteContext = {
  Bindings: MiniAppRouteScope
}

/**
 * The HOST app's own Hono environment, where `userId` really is a context variable set by an
 * app-level middleware.
 *
 * Separate from {@link MiniAppRouteContext} on purpose. One type used to serve both, so a
 * contributed router typed against it could read `c.get('userId')` — correct in the host's app,
 * `undefined` in every mounted mini app — and the compiler agreed. Keeping them apart is what makes
 * "which app am I mounted in?" a question the types answer.
 */
export type HostRouteContext = {
  Bindings: MiniAppRouteScope
  Variables: {
    userId: string
  }
}

/**
 * Stable JSON error envelope shared by host and mini app Hono routers.
 *
 * `message` is the one human sentence; `detail` is the raw engine/CLI text behind it, and is
 * omitted when there is nothing more specific to say. Without the second slot a route that HAD
 * both — every `toErrorInfo()` caller does — had to choose between telling the person what to do
 * and telling an operator what actually happened. The client (`unwrapMiniAppResponse`) reads both.
 */
export function jsonError(
  context: Context,
  status: JsonErrorStatus,
  code: string,
  message: string,
  detail?: string,
) {
  return context.json({ error: { code, message, ...(detail ? { detail } : {}) } }, status)
}

/**
 * The only part of a Zod failure this module reads.
 *
 * Structural on purpose rather than `z.ZodError`: the host and each mini app resolve their OWN zod,
 * so a nominal parameter type makes the same error object rejected across a package boundary even
 * when the versions match.
 */
export interface ZodIssueLike {
  path: readonly PropertyKey[]
  message: string
}
export interface ZodIssueBearer {
  issues: readonly ZodIssueLike[]
}

/** A Zod failure rendered for humans, in the three shapes the two error envelopes need. */
export interface ZodIssueSummary {
  /** `field: message` for the first issue — always safe as a headline. */
  headline: string
  /** Every issue as `field: message`, joined — for a `detail` slot or a log line. */
  detail: string
  /** {@link headline} plus a trailing `(invalid: a, b)` when more than one field failed. */
  message: string
}

/**
 * Summarize a Zod failure as text a caller can act on.
 *
 * `ZodError.message` is NOT that text: it is `JSON.stringify(issues, null, 2)`, a multi-line dump of
 * objects with `origin`/`code`/`minimum` keys. Both error envelopes in this repo put it where a UI
 * shows a message — `jsonError`'s `{error:{code,message}}` and the mini apps' flat
 * `{error, code, detail}` — so a rejected request rendered as a wall of JSON with the actual reason
 * buried inside it. Measured on the real projects router: a 24-line blob for one empty field.
 *
 * Lives here because this file already owns the envelope, and because the alternative was five
 * mini apps each formatting issues their own way — one rule with five implementations, which
 * drifts.
 *
 * Envelope with a `detail` slot → use `headline` + `detail`; that is what {@link defaultErrorHandler}
 * does, now that `jsonError` carries one. Envelope without one → use `message`, which folds the
 * extra field names into the sentence rather than losing them.
 */
export function summarizeZodIssues(error: ZodIssueBearer): ZodIssueSummary {
  const issues = error.issues
  const at = (path: readonly PropertyKey[]) => (path.length ? path.map(String).join('.') : '')
  const line = (issue: ZodIssueLike) => {
    const where = at(issue.path)
    return where ? `${where}: ${issue.message}` : issue.message
  }
  const first = issues[0]
  const headline = first ? line(first) : 'Invalid request'
  const fields = issues.map((issue) => at(issue.path) || '(body)')
  return {
    headline,
    detail: issues.map(line).join('; '),
    // Naming every failed field means one retry can fix all of them instead of one per round-trip.
    message: issues.length > 1 ? `${headline} (invalid: ${fields.join(', ')})` : headline,
  }
}

/** A schema as far as {@link jsonBody} reads it — structural, for the reason on {@link ZodIssueLike}. */
export interface BodySchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: ZodIssueBearer }
}

const JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json(;|$)/iu

/**
 * A route's JSON body: parsed only when it ARRIVED as JSON, validated by `schema`, refused in the
 * house envelope otherwise. Read it in the handler with `c.req.valid('json')`.
 *
 * `c.req.json()` parses whatever arrived, and that is a hole, not a style: a `text/plain` POST is a
 * SIMPLE request, sent by a page on any origin with no preflight — and the preflight is the one
 * thing the host's localhost-only CORS can deny. A JSON content type forces it. So a body under
 * any other type is refused here before it is read, including the empty body an all-optional
 * schema would otherwise accept (Hono's own `validator` hands such a request `{}`).
 */
export function jsonBody<T>(schema: BodySchema<T>) {
  return validator('json', (value, context) => {
    if (!JSON_CONTENT_TYPE.test(context.req.header('Content-Type') ?? ''))
      return jsonError(context, 400, 'json_required', 'Send the request body as JSON.')
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
    const summary = summarizeZodIssues(parsed.error)
    return jsonError(context, 400, 'invalid_request', summary.headline, summary.detail)
  })
}

/**
 * Portable feature-router error handler. Domain routes may handle their typed
 * failures first; this maps shared validation/API errors and rethrows unknowns
 * for the host's terminal error boundary.
 */
export function defaultErrorHandler(error: unknown, context: Context) {
  if (error instanceof z.ZodError) {
    // NOT `error.message` — that is the raw JSON issue dump. See {@link summarizeZodIssues}.
    // The envelope has a `detail` slot, so the headline stays a headline and every failing field
    // still reaches an operator instead of being folded into the sentence.
    const summary = summarizeZodIssues(error)
    return jsonError(context, 400, 'invalid_request', summary.headline, summary.detail)
  }
  if (isApiError(error)) {
    return jsonError(context, error.status, error.code, error.message, error.detail)
  }
  throw error
}
