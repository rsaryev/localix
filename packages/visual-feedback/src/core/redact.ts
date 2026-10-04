/**
 * Payload safety for captures that flow into an LLM prompt.
 *
 * A picked element's `html`/`text`/selector are sent verbatim to the agent, so a
 * token in an `href` (`?access_token=…`), a secret-shaped value in an `aria-label`,
 * or a visible API key in the element text would leak straight into the model
 * context. This module redacts secret-shaped tokens and strips query/hash (and
 * credentials) from embedded URLs — where secrets hide — and caps every field to a
 * byte budget so a pathological page can't bloat the prompt.
 *
 * Pure string logic, zero DOM. Applied at capture time (so secrets never cross the
 * postMessage boundary) AND re-applied host-side before the agent message is built.
 * `clampCapture` is idempotent, so the double application is safe — the host pass is
 * the authoritative one (defense in depth, independent of probe version).
 */

import type { VfCapture } from '../protocol/index'

const REDACTED = '[redacted]'

/** Token shapes that must never reach the agent verbatim. Most-specific first. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // anthropic
  // `sk-`-prefixed keys. The body allows `-`/`_` because every CURRENT format puts a
  // segment there: OpenAI issues `sk-proj-…` and `sk-svcacct-…`, OpenRouter `sk-or-v1-…`.
  // The old `sk-[A-Za-z0-9]{20,}` demanded 20 straight ALNUM after `sk-`, so it matched
  // only the legacy flat key and let every one of those through — `sk-ant-` survived only
  // because it has its own line above. Leading `\b` and alnum ends are what keep it from
  // eating ordinary hyphenated prose (`risk-assessment-…` has no boundary before `sk`).
  // Keep in step with `apps/api/src/lib/secret-redaction.ts` — the duplication is
  // deliberate (server lib vs browser package), so a pattern added to one must be added
  // to the other or this copy silently stops covering a key shape the other one does.
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
export function redactSecrets(input: string | undefined): string | undefined {
  if (!input) return input
  let out = input
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED)
  return out
}

const SAFE_URL_SCHEMES = new Set(['http:', 'https:'])

/**
 * Strip query, hash, and credentials from a URL (where tokens hide), keeping
 * origin+path for context. Returns `undefined` for dangerous schemes
 * (`javascript:`/`data:`/`blob:` …) so they're dropped, and best-effort strips
 * `?…`/`#…` from relative or unparseable inputs.
 */
export function sanitizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw
  const trimmed = raw.trim()
  try {
    const u = new URL(trimmed)
    if (!SAFE_URL_SCHEMES.has(u.protocol)) return undefined
    u.search = ''
    u.hash = ''
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    // Relative or non-absolute: drop everything from the first ? or # onward,
    // and reject obvious dangerous schemes.
    if (/^\s*(?:javascript|data|blob|vbscript):/i.test(trimmed)) return undefined
    return trimmed.replace(/[?#].*$/s, '')
  }
}

/** Strip query/hash from URLs embedded in a free string (attr values + bare http(s)). */
function redactUrlsInText(s: string): string {
  return s
    .replace(
      /\b(href|src|action|formaction|poster|cite)=("|')(.*?)\2/gi,
      (_m, attr: string, q: string, val: string) => `${attr}=${q}${sanitizeUrl(val) ?? ''}${q}`,
    )
    .replace(/https?:\/\/[^\s"'<>)]+/gi, (m) => sanitizeUrl(m) ?? '')
}

/** Per-field caps (chars). Second line of defense after redaction — bounds prompt cost. */
export const VF_LIMITS = {
  selector: 500,
  summary: 120,
  domPath: 300,
  classes: 200,
  role: 40,
  text: 200,
  componentPath: 200,
  html: 220,
  computedStyle: 200,
  members: 24,
  memberSelector: 300,
} as const

/** Length cap with surrogate-safe truncation (never split an emoji pair). */
function clampString(s: string | undefined, max: number): string | undefined {
  if (s == null || s.length <= max) return s
  let cut = max - 1 // leave room for the ellipsis
  const boundary = s.charCodeAt(cut - 1)
  if (boundary >= 0xd800 && boundary <= 0xdbff) cut -= 1
  return `${s.slice(0, cut)}…`
}

/** redact secrets + strip URL query/hash + cap length, in that order. */
function scrub(s: string | undefined, max: number): string | undefined {
  if (s == null) return s
  return clampString(redactSecrets(redactUrlsInText(s)), max)
}

/**
 * Sanitize a capture before it reaches the agent. Idempotent: safe to apply at
 * capture time and again host-side. `rect`/`kind`/`source` are structural (no
 * free-text secrets) and pass through; `computedStyle` is CSS values only, so it's
 * length-capped but not redacted.
 */
export function clampCapture(c: VfCapture): VfCapture {
  return {
    ...c,
    selector: scrub(c.selector, VF_LIMITS.selector) ?? '',
    summary: scrub(c.summary, VF_LIMITS.summary) ?? '',
    domPath: scrub(c.domPath, VF_LIMITS.domPath) ?? '',
    classes: scrub(c.classes, VF_LIMITS.classes) ?? '',
    role: scrub(c.role, VF_LIMITS.role),
    text: scrub(c.text, VF_LIMITS.text),
    componentPath: scrub(c.componentPath, VF_LIMITS.componentPath),
    html: scrub(c.html, VF_LIMITS.html),
    computedStyle: clampString(c.computedStyle, VF_LIMITS.computedStyle),
    members: c.members
      ?.slice(0, VF_LIMITS.members)
      .map((m) => scrub(m, VF_LIMITS.memberSelector) ?? '')
      .filter(Boolean),
  }
}
