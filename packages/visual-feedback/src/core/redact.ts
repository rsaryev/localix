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

import { redactSecrets as redactSecretShapes } from './secret-shapes'
import type { VfCapture } from '../protocol/index'

/** Preserve optional capture fields while applying the shared token rules. */
export function redactSecrets(input: string | undefined): string | undefined {
  return input ? redactSecretShapes(input) : input
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
