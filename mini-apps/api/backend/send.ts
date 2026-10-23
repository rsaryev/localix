/**
 * Sending one request. The only module here that touches the network.
 *
 * Redirects are followed MANUALLY (`redirect: 'manual'`) so every hop passes the SSRF guard.
 * `fetch`'s own redirect handling would check only the first url: a public host answering
 * `302 → http://169.254.169.254/` is the standard way to turn an outbound request into a read of
 * the cloud metadata service, and an automatic redirect makes that invisible to us.
 */

import { checkUrlSafety, readBodyCapped, type HostResolver } from '@localixai/mini-app-sdk/backend'
import { finalHeaders } from './auth'
import { decodingPlan } from './charset'
import { type Cookie, collectCookies } from './cookie-jar'
import type { RedirectHop, ResponseCookie } from './contracts'
import { RequestTimeoutError, SendError } from './send-errors'
import {
  redactResponseSecrets,
  redactTextSecrets,
  requestCredentialValues,
} from './response-redaction'
import {
  buildUrl,
  type RequestSpec,
  unfilledPathParams,
  unfilledPathParamsProblem,
} from './request-spec'
import { isHttpUrl, urlProblem } from './request-url-policy'
import {
  finalCookies,
  reportUrl,
  encodeBody,
  toHeaderInit,
  methodAfterRedirect,
  stripBodyHeaders,
  withCookies,
  stripAuthAcrossOrigin,
} from './send-wire'

export { reportUrl, encodeBody } from './send-wire'

export interface SendOptions {
  timeoutMs: number
  maxBodyBytes: number
  allowPrivateNetwork: boolean
  signal?: AbortSignal
  /** Resolved native-Vault environment values, used only to scrub reflected response data. */
  secretValues?: readonly string[]
  /** Host resolver for the address check; tests inject one so no real DNS is consulted. */
  resolveHost?: HostResolver
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

const MAX_REDIRECTS = 10

export { RequestTimeoutError } from './send-errors'

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
 * reaching your own LAN, and no value of it should make `file://` a thing this mini app does.
 */
async function guard(url: URL, allowPrivate: boolean, resolveHost?: HostResolver): Promise<void> {
  // `blocked`, not `bad_request`: both of these are well-formed urls we are REFUSING. The route
  // turns that into a 403 and the UI must not offer a retry — we would refuse it again.
  if (!isHttpUrl(url.toString())) {
    throw new SendError(
      'blocked',
      `Refusing to send to "${url.protocol}//…" — this client speaks http(s) only. A ${url.protocol} url can read local files, and no setting enables it.`,
    )
  }
  if (allowPrivate) return
  const problem = await checkUrlSafety(url, resolveHost)
  if (problem) {
    throw new SendError(
      'blocked',
      `${problem}. Enable "Allow private/internal hosts" in the REST API Client mini app settings to call it anyway.`,
    )
  }
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
  // That is the third time this mini app has split a guarantee across two send paths and lost one
  // (see `guard` and `unfilledPathParams` above). An option a function accepts and ignores is
  // worse than one it does not accept: the caller has no way to notice.
  //
  // ONE signal for the WHOLE chain, not one per hop — "per-request" means the request, and a
  // per-hop timer would let ten redirects take ten times the limit.
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  // Refused BEFORE the fetch, and here rather than in a caller, for the same reason `guard` lives
  // in this function: every send funnels through it, so this is the one place no caller can forget
  // — a saved request, an imported one and a one-shot all arrive here. The lesson this mini app has
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
    await guard(url, opts.allowPrivateNetwork, opts.resolveHost)
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
