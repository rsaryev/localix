import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

import { LOCALIX_CLIENT_HEADER } from './client-header'
import { jsonError } from './http'
import { dialableRuntimeHost } from './runtime-address'

/**
 * Which browser pages, and which Host names, may drive the local API.
 *
 * THE DEFECT THIS STOPS. The API has no authentication and listens on a well-known loopback port,
 * and a loopback address is reachable from EVERY page the user's browser opens, not only from
 * Localix. Four doors were open:
 *
 *  - A websocket upgrade checked nothing, so any site could open `ws://127.0.0.1:5051/rpc/ws`,
 *    read the session stream and send `interact` to approve a pending bash command.
 *  - Nothing checked `Host`, so DNS rebinding (a site's name re-resolved to 127.0.0.1) made every
 *    `/rpc` route same-origin to that site — terminal create + input is remote code execution.
 *  - CORS reflected any `localhost`/`127.0.0.1` origin on any port, which includes the agent's own
 *    preview servers and a cloned repository's dev server.
 *  - A body-less `POST`/`DELETE` is a "simple" request: a page fires it with `mode: 'no-cors'` and
 *    no preflight, so CORS never gets a say (Kubernetes drain, Docker volume removal, …).
 *
 * THE RULE, in the order a request is judged ({@link judgeRequest}):
 *
 *  1. `Host` must name this machine by a loopback name — the rebinding defence. Only the HOSTNAME
 *     is compared, not the port: the port is known only after `listen` (the desktop shell's port
 *     can fall back to an OS-assigned one), and a rebinding page's `Host` carries its OWN domain,
 *     which is what the check rejects.
 *  2. A browser always sends `Origin` on a websocket handshake and on every non-GET request. When
 *     it is present it must be one of the origins this boot allows ({@link createLocalOriginPolicy})
 *     — an explicit set, never "any localhost port".
 *  3. A state-changing request WITHOUT `Origin` comes from a non-browser client (the CLI, curl, a
 *     test) — or from a browser that dropped the header. It must carry something a page cannot
 *     send without a preflight: the {@link LOCALIX_CLIENT_HEADER}, or a non-safelisted
 *     `Content-Type` such as `application/json` (so the documented `curl` webhook call needs no
 *     extra header).
 *
 * GET and HEAD stay open to any origin: CORS already stops a foreign page from READING the answer,
 * and the preview probe (`/vf/probe.js`) and media are loaded by tags on other origins.
 */

/**
 * The packaged desktop page's origin: `tauri://localhost` on macOS/Linux, `http(s)://tauri.localhost`
 * on Windows. `localix-app://app` is a plugin installed as its own Mac app, which serves the same UI
 * build from Localix.app under its own scheme (`app_runner_scheme.rs`); no web page can claim it.
 * The Windows names are allowed only on Windows: elsewhere they are ordinary hostnames a resolver or
 * another local app could answer for, not the packaged page.
 */
export function packagedAppOrigins(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32'
    ? [
        'tauri://localhost',
        'http://tauri.localhost',
        'https://tauri.localhost',
        'localix-app://app',
      ]
    : ['tauri://localhost', 'localix-app://app']
}

const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '[::1]']

/** `name` or `name:port`, or a bracketed IPv6 literal — nothing a URL parser could reinterpret. */
const HOST_HEADER_RE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/iu

const SAFE_METHODS = new Set(['GET', 'HEAD'])

/** The three `Content-Type`s a browser may send cross-site without a preflight (Fetch §2.2.2). */
const CORS_SAFELISTED_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
])

export interface LocalOriginPolicyInput {
  /** Extra page origins, e.g. the dev UI (`LOCALIX_UI_ORIGINS`). Exact origins only. */
  uiOrigins?: readonly string[]
  /** The API serves the UI itself (`LOCALIX_UI_DIR`), so its own origin is a first-party page. */
  servesUi?: boolean
  /** The configured bind host (`HOST`). A concrete non-loopback address is accepted as a Host name. */
  bindHost?: string
  /** The platform the packaged page runs on; decides its origin. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
}

export interface LocalOriginPolicy {
  allowsHost(host: string | undefined): boolean
  /** `host` is the request's `Host`, used only for the same-origin case of a UI the API serves. */
  allowsOrigin(origin: string, host: string | undefined): boolean
}

/**
 * Reduce a configured origin to its canonical `scheme://host[:port]`, or throw.
 *
 * Throwing is the point: a typo here (`localhost:5050` without a scheme, a trailing path, a `*`)
 * would otherwise silently allow nothing — or, worse, invite a wildcard matcher later.
 */
export function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`Invalid UI origin "${raw}": expected scheme://host[:port]`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid UI origin "${raw}": only http and https origins can be added`)
  }
  if (url.origin !== trimmed.replace(/\/$/u, '')) {
    throw new Error(`Invalid UI origin "${raw}": expected scheme://host[:port] with no path`)
  }
  return url.origin
}

/** Parse the comma-separated `LOCALIX_UI_ORIGINS` value. Blank → none. */
export function parseUiOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .filter((part) => part.trim())
    .map(normalizeOrigin)
}

/** The lowercase hostname of a `Host` header (`[::1]` keeps its brackets), or null when malformed. */
function hostnameOf(host: string | undefined): string | null {
  if (!host || !HOST_HEADER_RE.test(host)) return null
  try {
    return new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function bracketed(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export function createLocalOriginPolicy(input: LocalOriginPolicyInput = {}): LocalOriginPolicy {
  const origins = new Set([
    ...packagedAppOrigins(input.platform ?? process.platform),
    ...(input.uiOrigins ?? []).map(normalizeOrigin),
  ])
  const hostnames = new Set(LOOPBACK_HOSTNAMES)
  // A wildcard bind dials as 127.0.0.1, already listed; a concrete address the operator chose is
  // the name its own clients will use, so it is accepted alongside the loopback names.
  if (input.bindHost) hostnames.add(bracketed(dialableRuntimeHost(input.bindHost)).toLowerCase())

  const allowsHost = (host: string | undefined): boolean => {
    const name = hostnameOf(host)
    return name !== null && hostnames.has(name)
  }
  return {
    allowsHost,
    allowsOrigin(origin, host) {
      if (origins.has(origin)) return true
      return Boolean(input.servesUi && host && allowsHost(host) && origin === `http://${host}`)
    },
  }
}

export interface GuardedRequest {
  method: string
  host: string | undefined
  origin: string | undefined
  upgrade: string | undefined
  clientHeader: string | undefined
  contentType: string | undefined
}

export type GuardVerdict =
  | { ok: true }
  | {
      ok: false
      code: 'forbidden_host' | 'forbidden_origin' | 'client_header_required'
      message: string
    }

function isSafelistedContentType(contentType: string | undefined): boolean {
  if (!contentType) return true
  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return CORS_SAFELISTED_CONTENT_TYPES.has(essence)
}

/** Judge one request against the policy — pure, so every branch is testable without a server. */
export function judgeRequest(policy: LocalOriginPolicy, req: GuardedRequest): GuardVerdict {
  if (!policy.allowsHost(req.host)) {
    return {
      ok: false,
      code: 'forbidden_host',
      message: 'The Localix API answers only requests addressed to this machine.',
    }
  }
  const isUpgrade = req.upgrade?.toLowerCase().includes('websocket') ?? false
  const method = req.method.toUpperCase()
  if (SAFE_METHODS.has(method) && !isUpgrade) return { ok: true }
  if (req.origin !== undefined) {
    return policy.allowsOrigin(req.origin, req.host)
      ? { ok: true }
      : {
          ok: false,
          code: 'forbidden_origin',
          message: 'This page is not allowed to use the Localix API.',
        }
  }
  // No Origin: a non-browser client. A websocket or a preflight carries no body to judge.
  if (isUpgrade || method === 'OPTIONS') return { ok: true }
  if (req.clientHeader?.trim() || !isSafelistedContentType(req.contentType)) return { ok: true }
  return {
    ok: false,
    code: 'client_header_required',
    message: `A request that changes state must send the ${LOCALIX_CLIENT_HEADER} header or a JSON body.`,
  }
}

export interface LocalOriginGuardLogger {
  warn(record: Record<string, unknown>): void
}

/** The middleware form of {@link judgeRequest}; mounted first in `createApp`, for every path. */
export function createLocalOriginGuard(
  policy: LocalOriginPolicy,
  logger?: LocalOriginGuardLogger,
): MiddlewareHandler {
  return async (c, next) => {
    // `app.request()` builds a Request without a `Host` header; the URL carries the same name.
    const host = c.req.header('host') ?? new URL(c.req.url).host
    const verdict = judgeRequest(policy, {
      method: c.req.method,
      host,
      origin: c.req.header('origin'),
      upgrade: c.req.header('upgrade'),
      clientHeader: c.req.header(LOCALIX_CLIENT_HEADER),
      contentType: c.req.header('content-type'),
    })
    if (verdict.ok) return next()
    logger?.warn({
      event: 'request.rejected',
      code: verdict.code,
      method: c.req.method,
      path: c.req.path,
      host,
      origin: c.req.header('origin') ?? null,
    })
    return jsonError(c, 403, verdict.code, verdict.message)
  }
}

/**
 * The guard, then CORS answering from the SAME policy — one unit, so the two cannot disagree or
 * be mounted in the wrong order. CORS used to reflect any localhost origin on any port, which let
 * the agent's preview servers and a cloned repository's dev server read this API's answers.
 */
export function createLocalOriginBoundary(
  policy: LocalOriginPolicy,
  logger?: LocalOriginGuardLogger,
): MiddlewareHandler[] {
  return [
    createLocalOriginGuard(policy, logger),
    cors({
      origin: (origin, c) => (policy.allowsOrigin(origin, c.req.header('host')) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // The packaged page is cross-origin, so the request id is unreadable unless exposed — and it
      // is what joins an Event Center row to its line in the API log.
      exposeHeaders: ['x-request-id'],
      // The packaged page is cross-origin to this API, so every write it sends with the client
      // header is preflighted. Caching the answer keeps that to one preflight per URL instead of
      // one per request (browsers cap the cache: Chromium at 2 h, WebKit at 10 min).
      maxAge: 7200,
    }),
  ]
}
