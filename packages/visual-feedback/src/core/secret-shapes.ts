/** Pure string safety rules; no DOM, protocol, or probe dependencies. */

const REDACTED = '[redacted]'

/**
 * A rule masks by structure, never an ordinary word: a false positive corrupts a diagnostic
 * while a rare miss costs little. A credential-named key, an auth header or a scheme word only
 * says where a credential may be; the value decides. `replace` returns its match unchanged when
 * the value is not a credential, which also keeps every rule idempotent.
 */
interface SecretRule {
  re: RegExp
  replace?: (match: string, ...groups: string[]) => string
}

const always = (re: RegExp): SecretRule => ({ re })

/** One ordinary word (`required`, `Missing`, `case-sensitive`): no credential looks like this. */
const isOrdinaryWord = (value: string): boolean =>
  /^(?:[a-z]+|[A-Z][a-z]*|[A-Z]+)(?:[-'](?:[a-z]+|[A-Z][a-z]*|[A-Z]+))*$/.test(
    value.replace(/[.,;:!?)\]}]+$/, ''),
  )

const isLiteral = (value: string): boolean =>
  /^(?:true|false|null|undefined|none|nil)$/i.test(value)

/** Already masked, or only says whether a credential is set. */
const isNotCredential = (value: string): boolean =>
  value.includes(REDACTED) || isLiteral(value) || isOrdinaryWord(value)

/** A free-text `Bearer x`: long, with a letter-and-digit run holding a digit. Never a word or slug. */
const isBearerToken = (value: string): boolean =>
  value.length >= 16 &&
  /^[A-Za-z0-9._~+/=-]+$/.test(value) &&
  (value.match(/[A-Za-z0-9]+/g) ?? []).some((run) => run.length >= 8 && /[0-9]/.test(run))

const MEMBER_ACCESS = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/
const TOKEN_CHARS = /^[A-Za-z0-9._~+/=%-]{8,}$/
const AUTH_SCHEME = /^(?:bearer|basic|token|negotiate|ntlm|hawk|mac|api-?key|aws4-hmac-sha256)$/i
const COOKIE_ATTRIBUTE = /^(?:expires|max-age|domain|path|secure|httponly|samesite|partitioned)$/i

/** An auth header value: a known scheme and a token, or a bare token that passes the bearer test. */
function isAuthCredential(text: string): boolean {
  const parts = text.split(/\s+/)
  if (parts.length === 1) return isBearerToken(text.replace(/[.,;]+$/, ''))
  const token = (parts[1] ?? '').replace(/[.,;]+$/, '')
  return (
    parts.length === 2 &&
    AUTH_SCHEME.test(parts[0] ?? '') &&
    TOKEN_CHARS.test(token) &&
    !isNotCredential(token)
  )
}

/** A cookie header value: some `name=value` pair (not an attribute) whose value looks like a token. */
function isCookieCredential(text: string): boolean {
  return text.split(';').some((pair) => {
    const eq = pair.indexOf('=')
    if (eq < 0 || COOKIE_ATTRIBUTE.test(pair.slice(0, eq).trim())) return false
    const value = pair.slice(eq + 1).trim()
    return TOKEN_CHARS.test(value) && !isNotCredential(value) && !MEMBER_ACCESS.test(value)
  })
}

const SECRET_RULES: SecretRule[] = [
  always(/sk-ant-[A-Za-z0-9_-]{20,}/g), // anthropic
  // Segmented provider keys allow hyphens/underscores; word boundaries and alnum
  // ends keep ordinary hyphenated prose from matching.
  always(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{18,}[A-Za-z0-9]/g), // openai / openrouter / sk-* keys
  always(/gh[pousr]_[A-Za-z0-9]{20,}/g), // github tokens
  always(/\bgithub_pat_[A-Za-z0-9_]{20,}/g), // github fine-grained token
  always(/xox[baprs]-[A-Za-z0-9-]{10,}/g), // slack
  // aws access key id (AKIA long-term, ASIA temporary); no letter or digit on either side.
  always(/(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g),
  always(/-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g), // PEM private key block
  always(/AIza[0-9A-Za-z_-]{35}/g), // google api key
  always(/GOCSPX-[0-9A-Za-z_-]{20,}/g), // google oauth client secret
  always(/glpat-[0-9A-Za-z_-]{20,}/g), // gitlab personal access token
  always(/\b[rs]k_(?:live|test)_[0-9A-Za-z]{10,}/g), // stripe secret/restricted key
  always(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g), // jwt
  // URL userinfo password: only the password goes, the user and host stay readable.
  {
    re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:)([^\s/@'"]+)(?=@)/gi,
    // `host:3000@x` is a port, not a password.
    replace: (match, head, password) =>
      isNotCredential(password) || /^\d{1,5}$/.test(password) ? match : head + REDACTED,
  },
  // Auth and cookie header values, as a line (`Cookie: a=b`) or JSON (`"Authorization":"…"`).
  // The header name stays; the value goes unless it is prose (`Authorization: failed to parse`).
  {
    re: /\b((?:proxy-)?authorization|(?:set-)?cookie)(["']?\s*[:=]\s*["']?)([^"'\r\n]+)/gi,
    replace: (match, name, sep, value) => {
      const text = value.trim()
      if (isNotCredential(text)) return match
      const isCredential = /cookie/i.test(name) ? isCookieCredential(text) : isAuthCredential(text)
      return isCredential ? name + sep + REDACTED : match
    },
  },
  // Outside a header `Bearer` is ordinary English ("Bearer of bad news"): the value must look
  // like a token.
  {
    re: /\bbearer\s+([A-Za-z0-9._~+/=-]+)/gi,
    replace: (match, value) => (isBearerToken(value) ? REDACTED : match),
  },
  // Labeled secrets incl. compound keys (`access_token=`, `client_secret:`, `api_key=…`). After
  // `key: ` with a space, one ordinary word is prose (`password: required`); `=`, quoted and
  // JSON string values are always credentials.
  {
    re: /\b[a-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd)\b(["']?\s*[:=]\s*["']?)([A-Za-z0-9._-]{8,})["']?/gi,
    replace: (match, sep, value) =>
      /:[ \t]+$/.test(sep) && isNotCredential(value) ? match : REDACTED,
  },
]

/** Replace secret-shaped substrings with `[redacted]`. */
export function redactSecrets(input: string): string {
  let out = input
  for (const { re, replace } of SECRET_RULES) {
    out = replace ? out.replace(re, replace) : out.replace(re, REDACTED)
  }
  return out
}

/** Whether redaction would change the text, so detection and masking cannot disagree. */
export function hasSecretShape(input: string): boolean {
  return redactSecrets(input) !== input
}
