// Transport and message evidence used by the ordered agent error classifier.

// Phrases that can contain overflow-like words but mean transient throttling.
// Bedrock, for example, emits "Throttling error: Too many tokens, please wait";
// compacting the conversation cannot fix it and wastes the user's context.
const NON_CONTEXT_OVERFLOW_MESSAGE =
  /^(throttling error|service unavailable):|rate[ _-]?limit|too many requests/i

// Heuristic: provider rejected the request because the prompt exceeded the model's
// context window. Messages vary by provider ("maximum context length", "context_length_exceeded",
// "too many tokens", "prompt is too long"), so match the common shapes.
export function isContextOverflowMessage(message: string): boolean {
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
    // Provider shapes an overflow corpus knows and we missed:
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
export const NON_RETRYABLE_LIMIT_MESSAGE =
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
export const RETRYABLE_PROVIDER_MESSAGE =
  /overloaded|throttling(?: error|exception)?|too many requests|rate[ _-]?limit|internal (server )?error|server had an error|service unavailable|temporarily unavailable|bad gateway|gateway timeout|please (retry|try again)|try again later|you can retry|try your request again|stream ended (before|without)|ended without|incomplete (stream|response|chunk)|provider returned error|websocket (closed|error)|network error|connection (error|refused|lost)|upstream connect|reset before headers|socket connection was closed|other side closed|timed? ?out|http2 request did not get a response|resourceexhausted|retry delay|\b(429|50[0-4]|524)\b/i

/** True when the message names a transient provider fault (and no quota/billing cap). */
export function isRetryableProviderMessage(message: string): boolean {
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

export function isTransientNetworkError(error: unknown): boolean {
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

const PROVIDER_STATUS_IN_MESSAGE = /^[^\n]*?(?:^|\s)([1-5]\d{2}):(?:\s|$)/

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
  // Only the `providerHttpErrorMessage` shape counts: a status standing right before the
  // label's colon. Any other 3-digit number ("got 404 rows") is prose, not a status.
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(PROVIDER_STATUS_IN_MESSAGE)
  return match ? Number.parseInt(match[1], 10) : 0
}

/** The statuses this classifier words itself; any other status echoes the body (`verbatim`). */
export const HTTP_STATUS_SENTENCES: Partial<Record<number, string>> = {
  401: 'Authentication failed. Check your API key.',
  402: 'Insufficient credits. Top up your account.',
  403: 'Access denied. Your API key may not have permission for this model.',
  404: 'Model not found. The selected model may not be available.',
  429: 'Rate limit exceeded. Please wait a moment and try again.',
  500: 'Provider error (500). The AI provider had an internal error.',
  502: 'Provider unavailable (502). Try again in a moment.',
  503: 'Provider overloaded (503). Try again in a moment.',
}

export function httpStatusToUserMessage(status: number, raw: string): string {
  return HTTP_STATUS_SENTENCES[status] ?? (raw.length > 200 ? raw.slice(0, 200) + '…' : raw)
}
