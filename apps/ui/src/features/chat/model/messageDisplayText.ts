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
  // Quoted examples, inline code and fenced code are user prose, not reference chips.
  const protectedParts =
    /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|"[^"\n]*"|'[^'\n]*')/g
  return text
    .split(protectedParts)
    .map((part, index) => {
      if (index % 2) return part
      let result = part
      for (const token of tokens) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), '$1')
      }
      return result
    })
    .join('')
    .trim()
}
