/**
 * The wire contract between this mini app's backend routes and its own UI — the ONE place the two
 * agree on a shape. The UI imports these types directly (the mini app owns both sides), so a
 * route's response can never drift from what the sidebar reads.
 *
 * Every request-bearing type here is the REDACTED view: a `RequestInfo` is what leaves the
 * process, and `store.redactSpec` is what makes it safe. The store's `SavedRequest` deliberately
 * does NOT appear on the wire — that is the shape that may still hold a literal credential.
 */

import type { RequestSpec } from './request-spec'

/** A saved request as the UI sees it. `spec.auth` is always redacted. */
export interface RequestInfo {
  name: string
  createdAt: number
  updatedAt: number
  spec: RequestSpec
}

export interface RequestsResponse {
  requests: RequestInfo[]
}

/** One environment variable. Secret rows expose only their native-vault reference. */
export interface EnvVariable {
  name: string
  value: string
  disabled?: boolean
  secret?: boolean
}

/** An environment as the picker shows it; literal secret values never cross this boundary. */
export interface EnvironmentInfo {
  name: string
  active: boolean
  variables: EnvVariable[]
}

export interface EnvironmentsResponse {
  environments: EnvironmentInfo[]
}

/**
 * What the UI POSTs to create an environment. A `secret` literal is moved into the native vault
 * before the environment file is written; an existing `${secret:KEY}` reference is kept.
 */
export interface EnvironmentCreate {
  name: string
  variables: EnvVariable[]
}

/**
 * The whole variable list, as a PUT replaces it. Name comes from the path, not the body — a PUT
 * edits the environment it addresses. Replace, not merge: an omitted variable is gone, the same
 * rule `manage_environment`'s `save` follows so the two surfaces cannot disagree.
 */
export interface EnvironmentEdit {
  variables: EnvVariable[]
}

/**
 * A request's spec AND what it resolves to under the active environment.
 *
 * Both, not either. The template is what is SAVED and what a user edits; the rendered url is what
 * will actually be sent. Showing only the template hides where the request goes; showing only the
 * render hides that it is portable. The gap between them is the entire point of environments, so
 * the tab shows both.
 */
export interface ResolvedPreview {
  url: string
  /** Variables the request names that the active environment does not define. */
  missing: string[]
  environment: string | null
}

export interface RequestResponse {
  request: RequestInfo
  /** Absent when the request uses no variables — there is nothing to resolve. */
  resolved?: ResolvedPreview
}

/**
 * The editable surface of a request, as the tab PUTs it back.
 *
 * Deliberately NOT the whole spec: `auth` is absent and cannot be set from a browser. See
 * `updateRequestSchema` in routes.ts — a UI that could rewrite auth would be a UI that could point
 * a vaulted credential at a host of its choosing.
 */
export interface RequestEdit {
  url: string
  method: string
  headers: { name: string; value: string; disabled?: boolean }[]
  query: { name: string; value: string; disabled?: boolean }[]
  pathParameters?: { name: string; value: string; disabled?: boolean }[]
  /**
   * The whole body, `form` included. Carrying only `text` would mean a form body round-trips as
   * `text: undefined` and is deleted the first time anyone edits the url beside it.
   */
  body?: {
    mimeType?: string
    text?: string
    form?: { name: string; value: string; disabled?: boolean }[]
  }
  /**
   * Per-request send settings. Absent means "use the mini app default": `followRedirects` defaults
   * to true, `timeoutMs` to the mini app's configured timeout, `maxRedirects` to the built-in cap.
   * They live on the EDIT surface (not auth) because a browser may set them freely — none of them
   * can point a credential anywhere. A PUT REPLACES them: an omitted setting reverts to the
   * default rather than lingering from the stored copy.
   */
  followRedirects?: boolean
  timeoutMs?: number
  maxRedirects?: number
}

/**
 * What the UI POSTs to MINT a request from scratch — the manual "New request" flow the sidebar
 * offers so a user is not forced to ask the agent to create one.
 *
 * `name` is the identity and is required; everything else is optional so a blank request (just a
 * name, method GET) is a valid starting point the editor then fills in — the same "create empty,
 * flesh out, save" loop. `auth` is absent for the same reason it is
 * absent from `RequestEdit`: a browser never authors a credential. The agent adds auth later.
 */
export interface RequestCreate {
  name: string
  url?: string
  method?: string
  headers?: { name: string; value: string; disabled?: boolean }[]
  query?: { name: string; value: string; disabled?: boolean }[]
  pathParameters?: { name: string; value: string; disabled?: boolean }[]
  body?: {
    mimeType?: string
    text?: string
    form?: { name: string; value: string; disabled?: boolean }[]
  }
}

/**
 * WHO sent this request. The dropdown distinguishes an agent's send from the user's own so a
 * shared history reads unambiguously — the boot load and per-run tool loads append to the SAME
 * ring (see history.ts), and "who made this call" is exactly the question that ring raises.
 */
export type HistorySource = 'agent' | 'user'

/**
 * One past send of a request, as the response-history dropdown lists it. History is in-memory
 * and recent-only — see backend/history.ts for why it is not persisted.
 */
export interface HistoryEntryInfo {
  id: number
  at: number
  response: SendResponse
  source: HistorySource
  /**
   * The request AS IT WAS SENT, redacted. Kept because the saved request may have been edited
   * since — a history row that showed the CURRENT spec would misattribute an old response to a
   * request it never came from. Redacted like every other wire view: a literal credential is
   * masked, a `${secret:KEY}` reference stays legible.
   */
  request?: RequestSpec
}

export interface HistoryResponse {
  entries: HistoryEntryInfo[]
}

/**
 * One hop in a redirect chain — WHERE it went, WHAT it answered, and HOW LONG it took, so the
 * workbench can show a `301 → 302 → 200` timeline rather than a flat list of urls. Structured,
 * not a bare string, precisely so per-hop status and timing survive to the UI.
 *
 * `url` is masked exactly like the top-level `url`: an `apikey` credential placed in the query
 * never appears here (see `reportUrl` in send.ts), so a hop is safe to render AND to persist in
 * the history ring.
 */
export interface RedirectHop {
  url: string
  status: number
  elapsedMs: number
}

/**
 * A cookie the FINAL response set. A facet, not a jar: the send-time jar (cookie-jar.ts) lives for
 * one redirect chain and is then dropped, and this is only what the last hop asked the client to
 * store — surfaced so the workbench can show, e.g., that a login actually set a session. The value
 * is shown as-is: a `Set-Cookie` the server just sent back to THIS caller is one it chose to
 * disclose, not a credential this mini app is holding.
 */
export interface ResponseCookie {
  name: string
  value: string
}

/** The outcome of sending a request, as the response pane renders it. */
export interface SendResponse {
  status: number
  statusText: string
  url: string
  headers: Record<string, string>
  body: string
  bytes: number
  truncated: boolean
  elapsedMs: number
  /** Every hop, first to last. Length > 1 means the request was redirected. */
  hops: RedirectHop[]
  /**
   * Cookies the final response set, when it set any. Absent on the overwhelming majority of
   * responses — read from `Set-Cookie` on the LAST hop only, so a login's redirect chain is
   * summarised by the session it ends up holding rather than every intermediate cookie.
   */
  cookies?: ResponseCookie[]
}

/**
 * The result of an `import` driven from the workbench: the requests it produced (redacted, always
 * — this goes to a browser), and which of their names collided with an existing request and were
 * auto-suffixed. `saved: false` is a preview (nothing was written); `true` means the store now
 * holds them. `message` carries the same human-readable notes the agent tool prints — vaulting,
 * environments, placeholder-host warnings — so the UI need not re-derive them.
 */
export interface ImportResponse {
  requests: RequestInfo[]
  /** Names auto-renamed because they were taken, e.g. `api-users-2`. Empty on a clean import. */
  collisions: string[]
  saved: boolean
  message: string
}

/**
 * The formats a saved request can be exported to. `curl` is the one an agent and a person both
 * reach for — a shareable command that reproduces the request. Kept as an enum so adding a format
 * (HAR, for example) is one entry and the route's validation follows.
 */
export const EXPORT_FORMATS = ['curl'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Every failure this mini app's routes can name. The UI branches on the code, not the message. */
export type RestErrorCode =
  | 'request_not_found'
  | 'name_taken'
  | 'blocked'
  | 'timeout'
  | 'network_error'
  | 'secret_unavailable'
  | 'bad_request'

export interface RestErrorResponse {
  error: string
  code: RestErrorCode
  detail?: string
}
