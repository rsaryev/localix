import type { AgentToolResult } from './types'
import { normalizeAgentSources } from './sources'
import { HumanInLoopDismissedError, HumanInLoopTimeoutError } from './human-in-loop'
import { AgentRunError, type ModelUnavailableReason } from './errors'
import { isProviderHttpError, providerRetryDelayMs } from '../utils/provider-http-error'

// ---- Public error utilities ----------------------------------------------------

/**
 * What an overflow tells the person when no recovery absorbed it. Host-neutral: the SDK does
 * not know which commands its host offers, only what fixes the request.
 */
const CONTEXT_OVERFLOW_MESSAGE =
  'The conversation exceeded the model context window. Clear or shorten the conversation and resend, or switch to a model with a larger context window.'

export interface AgentErrorInfo {
  kind: 'abort' | 'dismissed' | 'timeout' | 'fatal' | 'context_overflow'
  userMessage: string
  retryable: boolean
  /**
   * The request exceeded the model's context window. The recovery is to send less history
   * and retry — not a plain retry (which would fail identically). A host that can shrink its
   * view acts on this; a plain retry loop must NOT treat it as retryable.
   */
  shouldCompress?: boolean
  /**
   * Provider-stated `Retry-After` (ms) parsed from a 429/5xx response header, when
   * present. The retry backoff honors it as a floor (clamped) so we don't re-fire
   * before the server's stated window and re-trigger the rate limit.
   */
  retryAfterMs?: number
  /**
   * The failure is a RATE LIMIT or a quota/billing/plan cap — the request was refused
   * because the account has spent its allowance, not because of a bug. Additive to
   * `kind` (which stays 'fatal') so no `kind` consumer changes; consumers that care
   * (failure telemetry, a loop that should stop firing into an exhausted quota) key on
   * this instead. A transient 429 also carries `retryable`/`retryAfterMs`; a terminal
   * quota cap does not.
   */
  rateLimited?: boolean
  /**
   * The provider refused the CREDENTIAL (a 401, or the runtime's `PROVIDER_AUTH_FAILED`): every
   * request on this connection fails the same way until the key or sign-in is fixed. Additive like
   * `rateLimited`, so it is what a consumer keys a standing "this connection cannot sign in"
   * condition on — never the wording of `userMessage`.
   */
  authFailed?: boolean
  /**
   * The chosen model could not be bound to a provider, and why (`NO_PROVIDER_CONNECTION` with a
   * host-supplied reason). Additive like `authFailed`: a consumer keys on this, not on the text.
   */
  modelUnavailable?: ModelUnavailableReason
  /**
   * `userMessage` is the error's OWN text — a provider's response body, a proxy's page, an
   * unrecognised exception — not a sentence this classifier wrote. Such text rendered in the
   * transcript as `403: {"message":"Key limit exceeded…"}`; a presenter (`presentError`) keeps
   * it out of the headline and the reason and offers it only as detail.
   */
  verbatim?: true
}

// Phrases that can contain overflow-like words but mean transient throttling.
// Bedrock, for example, emits "Throttling error: Too many tokens, please wait";
// compacting the conversation cannot fix it and wastes the user's context.
const NON_CONTEXT_OVERFLOW_MESSAGE =
  /^(throttling error|service unavailable):|rate[ _-]?limit|too many requests/i

// Heuristic: provider rejected the request because the prompt exceeded the model's
// context window. Messages vary by provider ("maximum context length", "context_length_exceeded",
// "too many tokens", "prompt is too long"), so match the common shapes.
function isContextOverflowMessage(message: string): boolean {
  const m = message.toLowerCase()
  if (NON_CONTEXT_OVERFLOW_MESSAGE.test(m)) return false
  return (
    m.includes('context length') ||
    m.includes('context_length') ||
    m.includes('maximum context') ||
    m.includes('context window') ||
    // z.ai surfaces overflow as a finish_reason token, underscored — the spaced
    // 'context window' substring above never matches it.
    m.includes('context_window') ||
    m.includes('too many tokens') ||
    m.includes('prompt is too long') ||
    m.includes('input is too long') ||
    m.includes('input length') ||
    m.includes('maximum allowed tokens') ||
    m.includes('exceeds the maximum') ||
    m.includes('token limit') ||
    m.includes('reduce the length') ||
    m.includes('request too large') ||
    m.includes('request_too_large') ||
    m.includes('request entity too large') ||
    m.includes('context limit') ||
    m.includes('too long for the model') ||
    m.includes('max input tokens') ||
    m.includes('input tokens exceed') ||
    // Provider shapes the runtime's overflow corpus knows and we missed (the drift test in
    // agent-runtime-pi pins the shared corpus):
    // xAI "maximum prompt length is N", llama.cpp "exceeds the available context
    // size" / DS4 "configured context size", GitHub Copilot "prompt token count
    // of X exceeds the limit of Y".
    m.includes('maximum prompt length') ||
    m.includes('context size') ||
    /exceeds the limit of \d/.test(m)
  )
}

// Provider-stated limits that are NOT transient: a quota / billing / plan cap does
// not clear on retry (and hammering it can extend the lockout). Checked BEFORE the
// retryable-message patterns — an OpenAI 429 "exceeded your current quota" must not
// be treated as a plain rate limit.
const NON_RETRYABLE_LIMIT_MESSAGE =
  // The optional separator in `usage[ _-]?limit` also catches the camel-cased
  // GoUsageLimitError/FreeUsageLimitError; 'out of budget' and 'available balance'
  // are gateway wordings for an exhausted allowance.
  /quota|billing|insufficient[ _-]?(credit|funds|balance)|usage[ _-]?limit|payment|purchase|plan limit|credit balance|out of budget|available balance/i

// Transient provider faults stated only in the MESSAGE (no HTTP status attached, or
// surfaced mid-stream as an SSE error event): Anthropic "Overloaded", generic 5xx
// phrasings, and a stream that ended before its terminal event (premature end) —
// all clear on a retry of the same request.
// Extended with the runtime's issue-derived corpus — run
// failures reach us as PLAIN Error messages (the adapter flattens the terminal
// assistant), so these substrings are the LIVE retry classifier for every run.
// Notable additions: OpenRouter "provider returned error", WebSocket close/error
// text (we ship the codex WS transport — a live run logged 'WebSocket closed
// 1006'), codex raw-fetch faults ("upstream connect", "reset before headers"),
// Bedrock's http2 no-response, "timed out" as plain text, gRPC ResourceExhausted,
// and explicit mid-stream retry guidance ("you can retry your request").
const RETRYABLE_PROVIDER_MESSAGE =
  /overloaded|throttling(?: error|exception)?|too many requests|rate[ _-]?limit|internal (server )?error|server had an error|service unavailable|temporarily unavailable|bad gateway|gateway timeout|please (retry|try again)|try again later|you can retry|try your request again|stream ended (before|without)|ended without|incomplete (stream|response|chunk)|provider returned error|websocket (closed|error)|network error|connection (error|refused|lost)|upstream connect|reset before headers|socket connection was closed|other side closed|timed? ?out|http2 request did not get a response|resourceexhausted|retry delay|\b(429|50[0-4]|524)\b/i

/** True when the message names a transient provider fault (and no quota/billing cap). */
function isRetryableProviderMessage(message: string): boolean {
  return !NON_RETRYABLE_LIMIT_MESSAGE.test(message) && RETRYABLE_PROVIDER_MESSAGE.test(message)
}

// Raw network-fault codes/names (and a tight set of message phrases) that mean a
// transient connection drop, NOT a provider rejection — these have no HTTP status to
// classify, so without this they fall through to a non-retryable `fatal` and kill the
// turn. Bun/undici surface several as `UND_ERR_*`. Walked through `error.cause`.
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ERR_STREAM_PREMATURE_CLOSE',
])

function isTransientNetworkError(error: unknown): boolean {
  let cur: unknown = error
  for (let depth = 0; cur && typeof cur === 'object' && depth < 5; depth++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof o.code === 'string' && TRANSIENT_NETWORK_CODES.has(o.code)) return true
    const msg = typeof o.message === 'string' ? o.message.toLowerCase() : ''
    if (
      msg.includes('fetch failed') ||
      msg.includes('socket hang up') ||
      msg.includes('premature close') ||
      msg.includes('network connection was lost') ||
      msg.includes('connection closed')
    )
      return true
    cur = o.cause
  }
  return false
}

/**
 * Classify an error thrown by an agent loop or tool execution into a
 * consumer-facing description. Use this to build user-facing error messages
 * without duplicating error-type checks in every consumer.
 */
export function classifyAgentError(error: unknown): AgentErrorInfo {
  const info = classifyErrorKind(error)
  // ONE place decides how long the provider said to wait, for every branch that produced a
  // rate limit or a retryable fault — not just the one branch that happens to see an HTTP
  // response. Before this, `retryAfterMs` was set inside the `FetchError` branch alone, and
  // that branch is unreachable in production (nothing mints that name, and the errors that
  // do arrive are flattened to a bare `Error`), so every cooldown used an invented constant
  // however precisely the server had stated its window.
  if (info.retryAfterMs !== undefined || !(info.rateLimited || info.retryable)) return info
  // Prose is mined only for a RATE LIMIT. It exists for one provider shape — a ChatGPT usage
  // cap, where pi renders the body's `resets_at` as "Try again in ~N min." and no header
  // carries it — and a plain transient message ("Service unavailable, try again in 30
  // minutes") is not an instruction about an allowance.
  const stated = providerRetryDelayMs(error, Date.now(), { fromMessage: info.rateLimited })
  return stated === undefined ? info : { ...info, retryAfterMs: stated }
}

function classifyErrorKind(error: unknown): AgentErrorInfo {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'RetryAbortError')) {
    return { kind: 'abort', userMessage: 'Cancelled', retryable: false }
  }
  if (error instanceof HumanInLoopDismissedError) {
    return { kind: 'dismissed', userMessage: 'Interaction cancelled', retryable: true }
  }
  if (error instanceof HumanInLoopTimeoutError) {
    return {
      kind: 'timeout',
      userMessage: 'The request expired before a response was provided.',
      retryable: true,
    }
  }

  if (error instanceof AgentRunError) {
    return agentRunErrorToInfo(error)
  }

  // A provider rejection — recognized by NAME, and its status read back out of the
  // "provider 401: …" message shape. Both are owned by `utils/provider-http-error.ts`;
  // this is the branch that makes them load-bearing (retry / failover / compact-and-retry).
  if (isProviderHttpError(error)) {
    const status = extractProviderStatus(error)
    // A 413 (payload too large) from an LLM endpoint is virtually always an oversized
    // prompt, and a 400 that names the window is the same class. Both recover by sending
    // less history, never by a plain retry, which fails identically; `shouldCompress`
    // tells a host that wires that recovery, and the message is what is left when none does.
    if (
      status === 413 ||
      ((status === 400 || status === 0) && isContextOverflowMessage(error.message))
    ) {
      return {
        kind: 'context_overflow',
        userMessage: CONTEXT_OVERFLOW_MESSAGE,
        retryable: false,
        shouldCompress: true,
      }
    }
    // Retry transient faults: 5xx (server/overload, incl. Anthropic's 529), 429
    // (rate limit) and 408 (request timeout) all clear on a retry. The loop's retry
    // path uses exponential backoff + a small attempt cap, so re-issuing a 429 is
    // gentle, not a hammer — and previously a raw `provider 429:` FetchError killed
    // the whole turn on the first hiccup (only the AgentRunError-wrapped form was
    // retried). A persistent 429/5xx also warrants provider/key fallback.
    // A quota/billing cap is terminal even when it arrives as a 429 (OpenAI's
    // "exceeded your current quota") — retrying can't clear it. Otherwise fall back
    // to the message patterns when no status could be parsed (proxy-mangled errors).
    const limitCapped = NON_RETRYABLE_LIMIT_MESSAGE.test(error.message)
    const transient =
      !limitCapped &&
      (status >= 500 ||
        status === 429 ||
        status === 408 ||
        (status === 0 && RETRYABLE_PROVIDER_MESSAGE.test(error.message)))
    const userMessage = httpStatusToUserMessage(status, error.message)
    return {
      kind: 'fatal',
      userMessage,
      retryable: transient,
      ...(HTTP_STATUS_SENTENCES[status] === undefined ? { verbatim: true as const } : {}),
      // No `retryAfterMs` here: `classifyAgentError` reads the stated delay ONCE, for every
      // branch. Setting it again here recomputed the same parse and left the key present with
      // an undefined value when the response said nothing.
      ...(limitCapped || status === 429 ? { rateLimited: true } : {}),
      ...(status === 401 ? { authFailed: true } : {}),
    }
  }

  // A provider timeout, matched by bare name because runtime adapters own the concrete
  // error class. `AbortSignal.timeout()` also aborts with a WHATWG `DOMException` named
  // `TimeoutError`, so both common sources share this structural boundary.
  // That makes 'TimeoutError' a RESERVED name in this vocabulary: any OTHER minter of it
  // is silently reported to the user as a provider fault and retried as one. `apps/api`'s
  // host-side deadline primitive (`lib/timeout.ts`) once did exactly that, so it is named
  // `DeadlineExceededError` instead. A reserved-name rule in
  // Runtime adapters keep this transport-independent — same
  // bare-string defect class as `AbortError` / `FetchError` / `tool_use`.
  if (error instanceof Error && error.name === 'TimeoutError') {
    return {
      kind: 'fatal',
      userMessage: 'Request timed out. The provider took too long to respond.',
      retryable: true,
    }
  }

  // Provider stream went idle mid-response (model emitted some output then hung).
  // Matched by name to avoid a dependency on the adapter module.
  if (error instanceof Error && error.name === 'StreamIdleTimeoutError') {
    return {
      kind: 'timeout',
      userMessage:
        'The model stalled mid-response and stopped sending data. Try again or pick another model.',
      retryable: true,
    }
  }

  // Host-side deadlines are deterministic local failures, not provider timeouts.
  // Handle them before the message-based transient-provider fallback below.
  if (error instanceof Error && error.name === 'DeadlineExceededError') {
    return { kind: 'fatal', userMessage: `Error: ${error.message}`, retryable: false }
  }

  // A raw transient network drop (no HTTP status to classify above) — a connection
  // reset / premature close / undici timeout mid-request is the most common real
  // stream failure and clears on a retry. Match it before the fatal fallthrough.
  if (isTransientNetworkError(error)) {
    return {
      kind: 'fatal',
      // No "Retrying…": this sentence is also the TERMINAL reason when every retry is spent,
      // and a failed turn that says it is retrying is a promise nothing keeps.
      userMessage: 'Network connection to the provider dropped.',
      retryable: true,
    }
  }

  const msg = error instanceof Error ? error.message : String(error)
  // Message-only classification for errors that reach here without a usable class
  // name or status (mid-stream SSE `error` payloads, proxy-flattened errors):
  // an overflow asks for a smaller history, a stated transient fault retries — the same
  // recoveries the typed branches above wire, so an unlucky error shape doesn't
  // kill the turn where a well-shaped one would recover.
  if (isContextOverflowMessage(msg)) {
    return {
      kind: 'context_overflow',
      userMessage: CONTEXT_OVERFLOW_MESSAGE,
      retryable: false,
      shouldCompress: true,
    }
  }
  if (isRetryableProviderMessage(msg)) {
    return {
      kind: 'fatal',
      userMessage: `Transient provider error (${msg.length > 160 ? msg.slice(0, 160) + '…' : msg})`,
      retryable: true,
      verbatim: true,
    }
  }
  // A quota / usage-limit / plan cap that arrived WITHOUT a parseable status (proxy-
  // flattened, or a mid-stream SSE error payload — how the prolite-plan "usage limit"
  // failures reached us). Terminal, but flagged rate-limited so it isn't an opaque fatal.
  if (NON_RETRYABLE_LIMIT_MESSAGE.test(msg)) {
    return {
      kind: 'fatal',
      userMessage: `Error: ${msg}`,
      retryable: false,
      rateLimited: true,
      verbatim: true,
    }
  }
  return { kind: 'fatal', userMessage: `Error: ${msg}`, retryable: false, verbatim: true }
}

function agentRunErrorToInfo(error: AgentRunError): AgentErrorInfo {
  switch (error.code) {
    case 'AGENT_UNAVAILABLE':
      return { kind: 'fatal', userMessage: error.message, retryable: false }
    case 'NO_PROVIDER_CONNECTION':
      // With a reason, the host composed the sentence from facts only it has (the model id, the
      // provider's name); without one, the generic sentence is all that can honestly be said.
      return error.reason
        ? {
            kind: 'fatal',
            userMessage: error.message,
            retryable: false,
            modelUnavailable: error.reason,
          }
        : {
            kind: 'fatal',
            userMessage: 'No provider connection selected. Choose a connection first.',
            retryable: false,
          }
    case 'NO_MODEL':
      return {
        kind: 'fatal',
        userMessage: 'No model selected. Choose a model first.',
        retryable: false,
      }
    case 'PROVIDER_AUTH_FAILED':
      return {
        kind: 'fatal',
        userMessage: 'Authentication failed. Check your API key.',
        retryable: false,
        authFailed: true,
      }
    case 'PROVIDER_INSUFFICIENT_CREDITS':
      return {
        kind: 'fatal',
        userMessage: 'Insufficient credits. Top up your account.',
        retryable: false,
        rateLimited: true,
      }
    case 'PROVIDER_ACCESS_DENIED':
      return {
        kind: 'fatal',
        userMessage: 'Access denied. Your API key may not have permission for this model.',
        retryable: false,
      }
    case 'PROVIDER_NOT_FOUND':
      return {
        kind: 'fatal',
        userMessage: 'Model not found. The selected model may not be available.',
        retryable: false,
      }
    case 'PROVIDER_RATE_LIMITED':
      return {
        kind: 'fatal',
        userMessage: 'Rate limit exceeded. Please wait a moment and try again.',
        retryable: true,
        rateLimited: true,
      }
    case 'PROVIDER_UNAVAILABLE':
      return {
        kind: 'fatal',
        userMessage: 'Provider unavailable. Try again in a moment.',
        retryable: true,
      }
    case 'PROVIDER_TIMEOUT':
      return {
        kind: 'fatal',
        userMessage: 'Request timed out. The provider took too long to respond.',
        retryable: true,
      }
    case 'ABORTED':
      return { kind: 'abort', userMessage: 'Cancelled', retryable: false }
    case 'HITL_DISMISSED':
      return { kind: 'dismissed', userMessage: 'Interaction cancelled', retryable: true }
    case 'HITL_TIMEOUT':
      return {
        kind: 'timeout',
        userMessage: 'The request expired before a response was provided.',
        retryable: true,
      }
  }
}

/**
 * Extract an HTTP status code from a provider error. FetchError messages look like
 * "provider 429: ...". Returns 0 when no status can be parsed. Exported so the
 * multi-key failover engine can classify which errors warrant trying the next key.
 */
export function extractProviderStatus(error: unknown): number {
  // AI SDK errors (APICallError) and many provider errors carry the HTTP status as
  // a numeric property — prefer that over scraping the message, which often omits it
  // (e.g. "Key limit exceeded (total limit)" with statusCode 403).
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    for (const key of ['statusCode', 'status', 'code']) {
      const value = obj[key]
      if (typeof value === 'number' && value >= 100 && value < 600) return value
    }
    const nested = obj.data as { error?: { code?: unknown } } | undefined
    const nestedCode = nested?.error?.code
    if (typeof nestedCode === 'number' && nestedCode >= 100 && nestedCode < 600) return nestedCode
  }
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/\b([1-5]\d{2})\b/)
  return match ? Number.parseInt(match[1], 10) : 0
}

/** The statuses this classifier words itself; any other status echoes the body (`verbatim`). */
const HTTP_STATUS_SENTENCES: Partial<Record<number, string>> = {
  401: 'Authentication failed. Check your API key.',
  402: 'Insufficient credits. Top up your account.',
  403: 'Access denied. Your API key may not have permission for this model.',
  404: 'Model not found. The selected model may not be available.',
  429: 'Rate limit exceeded. Please wait a moment and try again.',
  500: 'Provider error (500). The AI provider had an internal error.',
  502: 'Provider unavailable (502). Try again in a moment.',
  503: 'Provider overloaded (503). Try again in a moment.',
}

function httpStatusToUserMessage(status: number, raw: string): string {
  return HTTP_STATUS_SENTENCES[status] ?? (raw.length > 200 ? raw.slice(0, 200) + '…' : raw)
}

/**
 * Coerce any value returned by a tool's execute() into a valid AgentToolResult.
 * Provides a single safety boundary so a misbehaving third-party tool can never
 * crash the agent loop.
 */
export function coerceToolResult(value: unknown): AgentToolResult {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AgentToolResult).content === 'string'
  ) {
    const result = value as AgentToolResult
    if (result.sources === undefined) return result
    return { ...result, sources: normalizeAgentSources(result.sources) }
  }
  let detail: string
  try {
    detail =
      typeof value === 'object'
        ? JSON.stringify(value)
        : typeof value === 'symbol' || typeof value === 'function'
          ? Object.prototype.toString.call(value)
          : String(value as string | number | boolean | bigint | undefined)
  } catch {
    // Diagnostics must never defeat this safety boundary. Circular objects and
    // BigInt-containing plugin results are invalid, but still need coercing into
    // a normal tool error so the agent loop can continue.
    detail = '<unprintable value>'
  }
  console.warn(
    '[localixai/agent] Tool returned an unexpected value — coercing to error result:',
    detail,
  )
  return {
    content: 'Tool returned an unexpected value',
    isError: true,
    error: {
      kind: 'execution',
      message: `Tool returned ${typeof value} instead of AgentToolResult`,
      userMessage: 'Tool failed',
      retryable: false,
      fatal: false,
    },
  }
}
