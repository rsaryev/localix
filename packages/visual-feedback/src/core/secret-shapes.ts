/** Pure string safety rules; no DOM, protocol, or probe dependencies. */

const REDACTED = '[redacted]'

/** Secret token shapes shared by capture payloads and runtime diagnostics. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // anthropic
  // Segmented provider keys allow hyphens/underscores; word boundaries and alnum
  // ends keep ordinary hyphenated prose from matching.
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
  /\bbearer\s+[A-Za-z0-9._-]{12,}/gi, // `Authorization: Bearer <token>`
  // Labeled secrets incl. compound keys (`access_token=`, `client_secret:`, `api_key=…`).
  /\b[a-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
]

/** Replace secret-shaped substrings with `[redacted]`. */
export function redactSecrets(input: string): string {
  let out = input
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED)
  return out
}

/** Detect token shapes without exposing the stateful regular expressions to callers. */
export function hasSecretShape(input: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(input)
  })
}
