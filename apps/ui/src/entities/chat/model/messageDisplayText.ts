import type { MessageBinding } from '@/shared/api/contracts'

/** Display-only projection. Never rewrite persisted text or the model's prompt.
 * Exact binding tokens are authoritative; unknown references and code stay literal.
 */
export function messageDisplayText(text: string, bindings?: readonly MessageBinding[]): string {
  const tokens = (bindings ?? [])
    .filter((binding) => binding.kind === 'context')
    .map((binding) => binding.target.token)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!tokens.length) return text
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // Longest first (sorted above), so a token never loses to its own prefix.
  const tokenPattern = new RegExp(`(^|\\s)(?:${escaped.join('|')})(?=\\s|$)`, 'g')
  return text
    .split(PROTECTED_PARTS)
    .map((part, index) => (index % 2 ? part : part.replace(tokenPattern, '$1')))
    .join('')
    .trim()
}

/**
 * Quoted examples, inline code and fenced code are user prose, not reference chips. A single
 * quote only opens a quotation outside a word, so apostrophes ("don't", "isn't") never do.
 */
const PROTECTED_PARTS =
  /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|"[^"\n]*"|(?<!\w)'[^'\n]*'(?!\w))/g
