/**
 * Sending one request. The only module here that touches the network.
 *
 * Redirects are followed MANUALLY (`redirect: 'manual'`) so every hop passes the SSRF guard.
 * `fetch`'s own redirect handling would check only the first url: a public host answering
 * `302 → http://169.254.169.254/` is the standard way to turn an outbound request into a read of
 * the cloud metadata service, and an automatic redirect makes that invisible to us.
 */

import { checkUrlSafety, readBodyCapped } from '@localixai/plugin-sdk/backend'
import { finalHeaders, credentialQueryParam } from './auth'
import { decodingPlan } from './charset'
import { type Cookie, collectCookies, mergeCookieHeader, parseSetCookie } from './cookie-jar'
import type { RedirectHop, ResponseCookie } from './contracts'
import { RequestTimeoutError, SendError } from './send-errors'
import {
  redactResponseSecrets,
  redactTextSecrets,
  requestCredentialValues,
} from './response-redaction'
import {
  activePairs,
  bodyIsForm,
  buildUrl,
  FORM_URLENCODED,
  isHttpUrl,
  isMultipart,
  methodAllowsBody,
  type Pair,
  type RequestSpec,
  unfilledPathParams,
  unfilledPathParamsProblem,
  urlProblem,
} from './request-spec'
import { redactUrlCredentials } from './request-credentials'

export interface SendOptions {
  timeoutMs: number
  maxBodyBytes: number
  allowPrivateNetwork: boolean
  signal?: AbortSignal
  /** Resolved native-Vault environment values, used only to scrub reflected response data. */
  secretValues?: readonly string[]
}

export interface SendResult {
  status: number
  statusText: string
  /** The url that was called, with any credential IN IT masked — see `reportUrl`. */
  url: string
  headers: Record<string, string>
  body: string
  bytes: number
  truncated: boolean
  elapsedMs: number
  /**
   * Every hop, first to last — each `url` masked like the top-level `url`. Structured
   * ({url,status,elapsedMs}) rather than a bare string so the workbench can show a redirect's
   * status and timing, not only its destination. Length > 1 means redirects.
   */
  hops: RedirectHop[]
  /**
   * Cookies the FINAL response set, when it set any. Absent otherwise — read from `Set-Cookie` on
   * the last hop only. A facet for the UI, not the send-time jar (which lives for one chain then
   * is dropped — see cookie-jar.ts).
   */
  cookies?: ResponseCookie[]
  /**
   * Set when the server named a charset this runtime cannot decode, so `body` was read as UTF-8
   * and its non-ASCII text is wrong. Absent on the overwhelming majority of responses.
   */
  charsetProblem?: string
}

/**
 * The cookies the final response asked the client to store, parsed from its `Set-Cookie` headers.
 *
 * Reuses `parseSetCookie`, and MUST be given the array form (`Headers.getSetCookie()`): folding
 * every cookie into one comma-joined `get('set-cookie')` is lossy, because a comma is legal inside
 * `Expires=Wed, 21 Oct 2015…`. A `Max-Age=0` deletion is dropped rather than surfaced — the facet
 * is "what the client would now hold", and a cookie the server just cleared is not that.
 */
function finalCookies(setCookies: readonly string[]): ResponseCookie[] {
  const out: ResponseCookie[] = []
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw)
    if (!parsed || 'deleted' in parsed) continue
    out.push({ name: parsed.name, value: parsed.value })
  }
  return out
}

/**
 * The url as it may be REPORTED — the credential in it replaced by a mask.
 *
 * An `apikey` auth with `addTo: 'query'` puts a resolved secret INTO the url. That is correct on
 * the wire, and a disaster everywhere else: `url` and `hops` are printed to the model (a
 * transcript that gets persisted) and returned to the browser (a devtools network tab). The whole
 * point of `${secret:KEY}` is that the value never leaves this process, and for this one auth type
 * it was walking straight out in the first line of every response.
 *
 * Masked HERE, in the one place that mints both fields, rather than in each reporter — a caller
 * that forgets is exactly how this got shipped in the first place.
 */
export function reportUrl(raw: URL | string, spec: RequestSpec): string {
  const url = new URL(redactUrlCredentials(raw.toString(), 'REDACTED'))
  if (url.username) url.username = 'REDACTED'
  if (url.password) url.password = 'REDACTED'
  const param = credentialQueryParam(spec.auth)
  if (!param) return url.toString()
  if (!url.searchParams.has(param)) return url.toString()
  // ASCII, not the `••••••` the JSON views use: this goes through `URL`, which percent-encodes a
  // bullet into `%E2%80%A2%E2%80%A2…` — six characters of noise where a word should be.
  url.searchParams.set(param, 'REDACTED')
  return url.toString()
}

const MAX_REDIRECTS = 10

export { RequestTimeoutError, SendError } from './send-errors'

/** Encode the body per the spec's mimeType. Returns undefined for methods that carry none. */
export function encodeBody(spec: RequestSpec): { body?: BodyInit; contentType?: string } {
  if (!methodAllowsBody(spec.method) || !spec.body) return {}
  const { body } = spec
  if (bodyIsForm(body)) {
    // MULTIPART IS ITS OWN ENCODING, not urlencoded with a different label. `bodyIsForm` is true
    // for both, and this branch used to build `URLSearchParams` and hardcode the urlencoded
    // content-type for either — so a Postman `formdata` import (postman.ts maps it to
    // `multipart/form-data`) went out urlencoded, and the server 400'd or misparsed with nothing
    // saying why. `FormData` lets the runtime write the multipart body AND its boundary; a
    // hand-written `Content-Type: multipart/form-data` with no boundary is unparseable, which is
    // why this returns no contentType and lets fetch set it.
    if (isMultipart(body)) {
      const form = new FormData()
      for (const { name, value } of activePairs(body.form)) form.append(name, value)
      return { body: form }
    }
    const params = new URLSearchParams()
    for (const { name, value } of activePairs(body.form)) params.append(name, value)
    return { body: params.toString(), contentType: FORM_URLENCODED }
  }
  if (typeof body.text !== 'string' || body.text === '') return {}
  return { body: body.text, contentType: body.mimeType }
}

function toHeaderInit(pairs: readonly Pair[]): Record<string, string> {
  const out: Record<string, string> = {}
  const keys = new Map<string, string>()
  for (const { name, value } of pairs) {
    const lower = name.toLowerCase()
    const existingKey = keys.get(lower)
    if (!existingKey) {
      keys.set(lower, name)
      out[name] = value
      continue
    }
    // Fetch's Headers model combines repeated fields. Preserve that behavior before redirect and
    // cookie processing convert the list to a record; Cookie alone uses its RFC delimiter.
    out[existingKey] = `${out[existingKey]}${lower === 'cookie' ? '; ' : ', '}${value}`
  }
  return out
}

/**
 * Guard a url: the scheme first, then the address.
 *
 * THE SCHEME CHECK IS NOT DECORATION. `checkUrlSafety` reasons only about hostnames and IPs — it
 * was written for the central research reader, which validates http(s) somewhere else — so it returns
 * "safe" for `file:///etc/passwd`: the hostname is empty, so it is not localhost, not an IP, and
 * the DNS lookup throws into a `catch { return null }`. Bun's fetch then happily reads the file.
 *
 * The tool's send path caught that with its own post-render `isHttpUrl`. The ROUTE's send path did
 * not, and it renders `{{variables}}` too — so a saved `{{p}}` plus an environment where
 * `p = file:///Users/me/.ssh/id_rsa` returned that file to the browser. Measured, not theorised.
 *
 * It lives HERE now, in the one function that fetches, because that is the only place no caller
 * can forget. `ALLOW_PRIVATE_NETWORK` deliberately does NOT relax it: that setting is about
 * reaching your own LAN, and no value of it should make `file://` a thing this plugin does.
 */
async function guard(url: URL, allowPrivate: boolean): Promise<void> {
  // `blocked`, not `bad_request`: both of these are well-formed urls we are REFUSING. The route
  // turns that into a 403 and the UI must not offer a retry — we would refuse it again.
  if (!isHttpUrl(url.toString())) {
    throw new SendError(
      'blocked',
      `Refusing to send to "${url.protocol}//…" — this client speaks http(s) only. A ${url.protocol} url can read local files, and no setting enables it.`,
    )
  }
  if (allowPrivate) return
  const problem = await checkUrlSafety(url)
  if (problem) {
    throw new SendError(
      'blocked',
      `${problem}. Enable "Allow private/internal hosts" in the REST API Client plugin settings to call it anyway.`,
    )
  }
}

/**
 * A 303 — and, in practice, a 301/302 after a POST — continues as a GET without a body. 307/308
 * preserve the method and body by definition. Following the browser rule here keeps us honest
 * against real APIs rather than the spec's letter.
 */
function methodAfterRedirect(status: number, method: string): string {
  if (status === 307 || status === 308) return method
  if (status === 303) return 'GET'
  // Fetch/modern browser semantics only rewrite POST for 301/302. A PUT is intentionally
  // idempotent and must not quietly become a GET just because an endpoint moved.
  if ((status === 301 || status === 302) && method === 'POST') return 'GET'
  return method
}

/** Headers describing a body must leave with that body on POST → GET redirects. */
function stripBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const bodyHeaders = new Set([
    'content-encoding',
    'content-language',
    'content-length',
    'content-location',
    'content-type',
    'transfer-encoding',
  ])
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !bodyHeaders.has(name.toLowerCase())),
  )
}

/**
 * Merge the redirect chain's cookies into the outgoing headers, whatever case `Cookie` is in here
 * (`toHeaderInit` keeps the pair's own spelling, and `appendCookie` writes `Cookie`).
 */
function withCookies(
  headers: Record<string, string>,
  jar: readonly Cookie[],
): Record<string, string> {
  if (jar.length === 0) return headers
  const key = Object.keys(headers).find((h) => h.toLowerCase() === 'cookie')
  const merged = mergeCookieHeader(key ? headers[key] : undefined, jar)
  if (merged === '') return headers
  return { ...headers, [key ?? 'Cookie']: merged }
}

/** Credentials must not survive a hop to a different origin. */
function stripAuthAcrossOrigin(
  headers: Record<string, string>,
  from: URL,
  to: URL,
): Record<string, string> {
  if (from.origin === to.origin) return headers
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'authorization' || lower === 'cookie') continue
    out[name] = value
  }
  return out
}

export async function sendRequest(spec: RequestSpec, opts: SendOptions): Promise<SendResult> {
  const started = Date.now()

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new SendError('bad_request', 'Request timeout must be a positive number of milliseconds.')
  }
  if (
    spec.maxRedirects !== undefined &&
    (!Number.isInteger(spec.maxRedirects) || spec.maxRedirects <= 0)
  ) {
    throw new SendError(
      'bad_request',
      'Maximum redirects must be a positive whole number. Disable redirect following to allow none.',
    )
  }

  // THE TIMEOUT LIVES HERE, and it did not used to live anywhere. `SendOptions.timeoutMs` was
  // declared, documented in the README as "Per-request timeout", passed in by both callers — and
  // read by nothing. The tool path happened to survive because it separately wrapped the call in
  // `ctx.helpers.withTimeoutSignal`; the ROUTE path passed `timeoutMs` in good faith and got
  // nothing, so a send from the workbench hung for exactly as long as the server did. Measured:
  // `timeoutMs: 200` returned after 3011ms.
  //
  // That is the third time this plugin has split a guarantee across two send paths and lost one
  // (see `guard` and `unfilledPathParams` above). An option a function accepts and ignores is
  // worse than one it does not accept: the caller has no way to notice.
  //
  // ONE signal for the WHOLE chain, not one per hop — "per-request" means the request, and a
  // per-hop timer would let ten redirects take ten times the limit.
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  // Refused BEFORE the fetch, and here rather than in a caller, for the same reason `guard` lives
  // in this function: every send funnels through it, so this is the one place no caller can forget
  // — a saved request, an imported one and a one-shot all arrive here. The lesson this plugin has
  // already paid for twice is that a check living next to the feature that motivated it is a check
  // the composition escapes.
  // Before `buildUrl`, because `new URL` throws a raw TypeError and that TypeError was what the
  // user actually saw. This explains the url we were GIVEN; it does NOT replace the per-hop check
  // in `guard`, which is what stops a `302 → file://`. Both are needed: this one has the original
  // string and can tell a typo from an attack, `guard` has every redirect target and cannot.
  const preflightSecretValues = requestCredentialValues(
    spec,
    spec.url,
    spec.headers,
    opts.secretValues,
  )
  const problem = urlProblem(spec.url)
  if (problem) {
    throw new SendError(problem.code, redactTextSecrets(problem.message, preflightSecretValues))
  }

  // The url's OTHER placeholder syntax. This is NOT in the tool, where the `{{variables}}` check
  // lives, and the difference is the whole point: there are TWO send paths — the tool and the
  // route (routes.ts) — and `missingVarsProblem` is duplicated across both because each caller was
  // trusted to remember. That is precisely how `file://` shipped: the tool's path checked it, the
  // route's did not. So this one goes where `guard` goes.
  const unfilled = unfilledPathParams(spec.url, spec.pathParameters)
  if (unfilled.length > 0) {
    throw new SendError(
      'bad_request',
      redactTextSecrets(unfilledPathParamsProblem(unfilled, spec.url), preflightSecretValues),
    )
  }

  const initialUrl = buildUrl(spec)
  const signed = finalHeaders(spec, initialUrl)
  const responseSecretValues = requestCredentialValues(
    spec,
    signed.url,
    signed.headers,
    opts.secretValues,
  )
  const safeReportUrl = (raw: URL | string) =>
    redactTextSecrets(reportUrl(raw, spec), responseSecretValues)
  const { body, contentType } = encodeBody(spec)

  let headers = toHeaderInit(signed.headers)
  if (contentType && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = contentType
  }

  let url = signed.url
  let method: string = spec.method
  const hops: RedirectHop[] = []
  // A per-request override of the built-in cap — an endpoint whose chain is legitimately long can
  // raise it; a run that must never redirect at all uses `followRedirects: false`, not `0`.
  const maxRedirects = spec.maxRedirects ?? MAX_REDIRECTS
  // Cookies live for this chain only — see cookie-jar.ts. A login is `POST /login → 302 +
  // Set-Cookie → GET /dashboard`, and because we follow that redirect ourselves, we are the thing
  // that has to carry the cookie.
  let jar: Cookie[] = []

  for (let redirects = 0; ; redirects++) {
    await guard(url, opts.allowPrivateNetwork)
    const hopStarted = Date.now()

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: withCookies(headers, jar),
        // A redirected GET drops the body along with the method (see methodAfterRedirect).
        body: method === spec.method ? body : undefined,
        redirect: 'manual',
        signal,
      })
    } catch (err) {
      // `fetch` reports both a timeout and a user abort as an AbortError, so ask the timeout
      // itself rather than reading the message.
      if (timeout.aborted) {
        throw new RequestTimeoutError(
          `Request to ${safeReportUrl(url)} timed out after ${opts.timeoutMs}ms.`,
        )
      }
      throw err
    }

    // Recorded AFTER the fetch, because a hop's status and duration are not known until it answers
    // — the whole reason `hops` is structured. `url` is still masked (see `reportUrl`).
    hops.push({ url: safeReportUrl(url), status: res.status, elapsedMs: Date.now() - hopStarted })

    const location = res.headers.get('location')
    const isRedirect = res.status >= 300 && res.status < 400 && location
    if (!isRedirect || spec.followRedirects === false) {
      // Decode as the SERVER encoded it, not as we hope. A bare TextDecoder is UTF-8 always, so
      // a windows-1251 or Shift_JIS answer came back as replacement characters and got reasoned
      // about as if the API were broken.
      const plan = decodingPlan(res.headers.get('content-type'))
      const { text, bytes, truncated } = await readBodyCapped(res, opts.maxBodyBytes, plan.label)
      // What the LAST hop asked the client to store. Set-Cookie collected during the chain fed the
      // jar (dropped on return); this is the facet the UI shows — see `finalCookies`.
      const cookies = finalCookies(res.headers.getSetCookie?.() ?? [])
      return redactResponseSecrets(
        {
          status: res.status,
          statusText: res.statusText,
          url: safeReportUrl(url),
          headers: Object.fromEntries(res.headers.entries()),
          body: text,
          bytes,
          truncated,
          elapsedMs: Date.now() - started,
          hops,
          ...(cookies.length > 0 ? { cookies } : {}),
          ...(plan.problem ? { charsetProblem: plan.problem } : {}),
        },
        responseSecretValues,
      )
    }

    if (redirects >= maxRedirects) {
      throw new SendError(
        'blocked',
        `Too many redirects (>${maxRedirects}) starting at ${hops[0].url}`,
      )
    }
    const next = new URL(location, url)
    headers = stripAuthAcrossOrigin(headers, url, next)
    // A cookie NEVER crosses an origin. `stripAuthAcrossOrigin` drops the user's own `Cookie`
    // header one line up; a jar that re-added the session on the next hop would undo that guard
    // from the inside, which is worse than not having a jar at all.
    jar = next.origin === url.origin ? collectCookies(jar, res.headers.getSetCookie?.() ?? []) : []
    const nextMethod = methodAfterRedirect(res.status, method)
    if (nextMethod !== method && (nextMethod === 'GET' || nextMethod === 'HEAD')) {
      headers = stripBodyHeaders(headers)
    }
    method = nextMethod
    // Drain the redirect's own body so the socket is released rather than left half-read.
    await res.body?.cancel()
    url = next
  }
}
