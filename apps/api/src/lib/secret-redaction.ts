/**
 * Server-side secret redaction for logs. Logs routinely capture prompts, tool
 * args, request metadata and error strings — any of which can carry a token. This
 * scrubs secret-shaped substrings before a line is written, so a leaked key never
 * lands on stdout/disk. Pure functions; wired into the pino logger via logMethod.
 *
 * (The same pattern set guards the visual-feedback capture payload — see
 * packages/visual-feedback/src/core/redact.ts. Kept duplicated rather than coupling
 * a server lib to a browser package; the backlog tracks extracting a shared module.)
 */

const REDACTED = '[redacted]'
const TRUNCATED = '[truncated]'

/** A diagnostic is evidence, not a transcript/archive. Bound every individual
 * string before it reaches pino so an upstream error or console dump cannot copy
 * an entire prompt, terminal replay, or HTTP body into the runtime log. */
export const MAX_LOG_STRING_LENGTH = 16_384
export const MAX_LOG_COLLECTION_ENTRIES = 100

/** Token shapes that must never reach a log sink verbatim. Most-specific first. */
const SECRET_PATTERNS: RegExp[] = [
  /"(?:prompt|content|input|body|messages)"\s*:\s*"(?:\\.|[^"\\])*"/gi, // JSON message bodies
  /'(?:prompt|content|input|body|messages)'\s*:\s*'(?:\\.|[^'\\])*'/gi, // inspected JS message bodies
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // anthropic
  // `sk-`-prefixed keys. The body allows `-`/`_` because every CURRENT format puts a
  // segment there: OpenAI issues `sk-proj-…` and `sk-svcacct-…`, OpenRouter `sk-or-v1-…`.
  // The old `sk-[A-Za-z0-9]{20,}` demanded 20 straight ALNUM after `sk-`, so it matched
  // only the legacy flat key and let every one of those through — `sk-ant-` survived only
  // because it has its own line above. Leading `\b` and alnum ends are what keep it from
  // eating ordinary hyphenated prose (`risk-assessment-…` has no boundary before `sk`).
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{18,}[A-Za-z0-9]/g, // openai / openrouter / sk-* keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // github tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // slack
  /AKIA[0-9A-Z]{16}/g, // aws access key id
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, // PEM private key block
  /AIza[0-9A-Za-z_-]{35}/g, // google api key
  /GOCSPX-[0-9A-Za-z_-]{20,}/g, // google oauth client secret
  /glpat-[0-9A-Za-z_-]{20,}/g, // gitlab personal access token
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{10,}/g, // stripe secret/restricted key
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // jwt
  /\bbearer\s+[A-Za-z0-9._-]{12,}/gi, // Authorization: Bearer <token>
  // Labeled secrets incl. compound keys (access_token=, client_secret:, api_key=…).
  /\b[a-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
]

/** Replace secret-shaped substrings in a string with `[redacted]`. */
export function redactSecrets(input: string): string {
  let out = input
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED)
  return out
}

/** Redact secret-shaped substrings and cap one log field to a diagnostic-sized tail.
 * Keep both ends: prefixes identify the failing subsystem while the tail commonly
 * carries the actionable provider/transport error. */
export function sanitizeLogString(input: string): string {
  const redacted = redactSecrets(input)
  if (redacted.length <= MAX_LOG_STRING_LENGTH) return redacted
  const marker = `…${TRUNCATED}…`
  const remaining = MAX_LOG_STRING_LENGTH - marker.length
  const head = Math.ceil(remaining / 2)
  return redacted.slice(0, head) + marker + redacted.slice(redacted.length - (remaining - head))
}

/** Admission predicate for model-visible content. Unlike `redactSecrets`, callers
 * must drop the whole contribution rather than redact and forward partial data. */
export function hasSecretShape(input: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(input)
  })
}

const MAX_DEPTH = 5

const PRIVATE_LOG_FIELDS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'token',
  'secret',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'password',
  'passwd',
  'prompt',
  'prompts',
  'messages',
  'content',
  'body',
  'input',
  'stdin',
  'terminalinput',
  'requestbody',
  'responsebody',
])

function isPrivateLogField(key: string): boolean {
  return PRIVATE_LOG_FIELDS.has(key.toLowerCase().replace(/[-_]/g, ''))
}

/**
 * Deep-redact a log value: scrub strings, recurse arrays + PLAIN objects. Class
 * instances (Error, Date, streams…) pass through untouched so pino's serializers
 * still work and we don't accidentally walk a huge/circular runtime object.
 */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeLogString(value)
  if (value == null || typeof value !== 'object') return value
  // Never hand an uninspected deep subtree back to pino. The old depth guard did
  // exactly that, so a secret nested six levels down survived the redaction pass.
  if (depth >= MAX_DEPTH) return TRUNCATED
  if (Array.isArray(value)) {
    const visible = value.slice(0, MAX_LOG_COLLECTION_ENTRIES).map((v) => redactDeep(v, depth + 1))
    if (value.length > MAX_LOG_COLLECTION_ENTRIES) visible.push(TRUNCATED)
    return visible
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value // not a plain object
  const out: Record<string, unknown> = {}
  const record = value as Record<string, unknown>
  const terminalInputFrame = record.t === 'input' || record.type === 'terminal.input'
  const entries = Object.entries(record)
  for (const [k, v] of entries.slice(0, MAX_LOG_COLLECTION_ENTRIES)) {
    // Key-based privacy is essential for opaque OAuth values and ordinary-language
    // prompts: neither necessarily resembles a provider token. A terminal input
    // frame carries bytes under `data`, so recognize that semantic envelope too.
    out[k] =
      isPrivateLogField(k) || (terminalInputFrame && k === 'data')
        ? REDACTED
        : redactDeep(v, depth + 1)
  }
  if (entries.length > MAX_LOG_COLLECTION_ENTRIES) out['…'] = TRUNCATED
  return out
}
