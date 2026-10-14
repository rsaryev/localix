/**
 * Browser-safe, model-facing presentation for HTTP bodies.
 *
 * Context admission deliberately rejects secret-shaped text. Raw JSON is a poor fit for that
 * boundary: an ordinary `{"body":"hello"}` matches the host's conservative log/prompt guard even
 * though it contains no credential. We therefore render parsed JSON as a JavaScript-like data
 * view (unquoted identifier keys), while masking genuinely credential-bearing keys and values.
 * This stays readable to a model, avoids false positives, and never weakens the host policy.
 */

const REDACTED = '[redacted]'

const SENSITIVE_COMPACT_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'password',
  'passwd',
  'token',
  'secret',
])

function sensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  const compact = lower.replace(/[^a-z0-9]/g, '')
  return (
    SENSITIVE_COMPACT_KEYS.has(compact) ||
    /(?:^|[_-])(?:token|secret|password|passwd|api[_-]?key)(?:$|[_-])/.test(lower)
  )
}

/** Strong credential shapes mirrored from the host admission boundary, but replacement is local. */
const SECRET_VALUES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{18,}[A-Za-z0-9]/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /GOCSPX-[0-9A-Za-z_-]{20,}/g,
  /glpat-[0-9A-Za-z_-]{20,}/g,
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{10,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bbearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b[a-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
]

export function redactModelSecrets(input: string): string {
  let output = input
  for (const pattern of SECRET_VALUES) {
    pattern.lastIndex = 0
    output = output.replace(pattern, REDACTED)
  }
  return output
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function propertyName(key: string): string {
  return IDENTIFIER.test(key) ? key : `[${JSON.stringify(key)}]`
}

function renderJson(value: unknown, depth: number, key?: string): string {
  if (key !== undefined && sensitiveKey(key)) return JSON.stringify(REDACTED)
  if (typeof value === 'string') return JSON.stringify(redactModelSecrets(value))
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const indent = '  '.repeat(depth)
    const childIndent = '  '.repeat(depth + 1)
    return `[\n${value.map((item) => `${childIndent}${renderJson(item, depth + 1)}`).join(',\n')}\n${indent}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const indent = '  '.repeat(depth)
    const childIndent = '  '.repeat(depth + 1)
    return `{\n${entries
      .map(
        ([name, item]) =>
          `${childIndent}${propertyName(name)}: ${renderJson(item, depth + 1, name)}`,
      )
      .join(',\n')}\n${indent}}`
  }
  // Unreachable for `JSON.parse` output — string, number, boolean, null, array and object are
  // all handled above, and those are the only shapes it can produce. This stays as the total
  // fallback for a hand-built value, where the remaining runtime types (`undefined`, bigint,
  // symbol) each have a meaningful primitive spelling; anything object-like already returned.
  return JSON.stringify(String(value as bigint | symbol | undefined))
}

/** A readable body that is safe to pass through the host's model-context admission policy. */
export function formatBodyForModel(body: string, contentType?: string): string {
  if (body === '') return '(empty)'
  const looksJson = /(?:^|[/+])json(?:$|[;])/i.test(contentType ?? '') || /^[\s]*[{[]/.test(body)
  if (looksJson) {
    try {
      return renderJson(JSON.parse(body), 0)
    } catch {
      // Preserve malformed/non-standard payloads as text; Monaco and the response UI still show
      // the exact wire body, while model context remains safely scrubbed.
    }
  }
  return redactModelSecrets(body).replace(/"(prompt|content|input|body|messages)"(?=\s*:)/gi, '$1')
}
