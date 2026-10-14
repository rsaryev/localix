// Pure helpers for composer file MENTIONS — link-only `@path` references.
//
// A mention is just a path token left verbatim in the message text: it is NEVER
// expanded into the model's context (unlike the `@file:` context-ref, which
// inlines file contents). The model receives only the path; it decides whether
// to read the file. The UI renders the token as a clickable chip in both the
// composer and the sent message.
//
// Kept free of React / markdown imports so the matching rules stay
// unit-testable and can be shared by the composer (features/chat) and the
// markdown renderer (shared/ui) without crossing layers.
import { REF_RESERVED_WORDS, isAtomicRefToken } from '@localixai/api/context-refs'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'

/** Reserved context-ref keywords that are NOT link-only mentions (they expand).
 *  Derived from the shared ref-kind registry — a new kind is reserved for free.
 *  Prefix kinds (`file:`) match by prefix; keyword kinds (`diff`) exactly. */
const RESERVED_PREFIX = new RegExp(
  `^(?:${REF_RESERVED_WORDS.map((w) => (w.endsWith(':') ? w : `${w}$`)).join('|')})`,
)

/** Trailing sentence punctuation stripped off a mention path (`see @a.ts.` works). */
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"`]+$/

/** Looks like a workspace path worth linking: has a slash or a file extension. */
function looksLikePath(path: string): boolean {
  if (!path) return false
  return path.includes('/') || /\.[a-z0-9]+$/i.test(path)
}

/**
 * Matches an `@path` mention: an `@` at a word boundary followed by a
 * non-whitespace run. Reserved `@file:`/`@folder:`/`@diff`/`@git:` tokens and
 * non-path-looking tokens (e.g. `@someone`) are rejected by `mentionPathOf`.
 */
export const FILE_MENTION_RE = /(^|\s)@([^\s@]+)/g

/** Extracts the clean path from the raw token after `@`, or null if not a mention. */
export function mentionPathOf(rawAfterAt: string): string | null {
  if (RESERVED_PREFIX.test(rawAfterAt)) return null
  const path = rawAfterAt.replace(TRAILING_PUNCTUATION, '')
  return looksLikePath(path) ? path : null
}

/**
 * Length (chars after the `@`) of a recognized composer `@`-token — a link-only
 * `@path` mention OR an expanding context-ref (any registered kind) — or null
 * when `rawAfterAt` isn't a token. Shared by the inline pill highlighter and the
 * whole-token Backspace handler so both treat the exact same spans as a single
 * unit. The ref-token rules come from the shared ref-kind registry.
 */
export function atTokenLength(rawAfterAt: string): number | null {
  const trimmed = rawAfterAt.replace(TRAILING_PUNCTUATION, '')
  if (isAtomicRefToken(trimmed)) return trimmed.length
  const path = mentionPathOf(rawAfterAt)
  return path ? path.length : null
}

/** Short chip label for a mention path (its basename; folders keep a trailing `/`). */
export function mentionLabel(path: string): string {
  return path.endsWith('/') ? `${baseName(path)}/` : baseName(path)
}
