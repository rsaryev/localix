import { atTokenLength } from '@/shared/lib/fileMention'

/**
 * Backspace at the end of an `@`-reference deletes the WHOLE token, not one character.
 *
 * A reference READS as one unit — `@file:src/a.ts#L10-40`, `@git:3`, `@session:abc` — so
 * chewing it away a character at a time is both tedious and, midway through, meaningless.
 * This gives a plain textarea the chip-like deletion a real chip would have, without
 * making it a chip.
 *
 * The guard that matters is the LAST one: the run after `@` must be a token the parser
 * FULLY recognizes. Without it, `@a.ts, and…` would match the loose pattern and a single
 * Backspace after the comma would eat half the sentence. Requiring `atTokenLength` to
 * consume the entire run means a token trailed by punctuation is left alone and deleted
 * the ordinary way.
 *
 * Returns the new prompt text when it claimed the key, else null (caller does nothing).
 */
export function promptAfterMentionBackspace(e: React.KeyboardEvent, prompt: string): string | null {
  if (e.key !== 'Backspace') return null
  const el = e.target as HTMLTextAreaElement
  // Only a COLLAPSED caret — a selection Backspace means "delete the selection".
  if (el.selectionStart !== el.selectionEnd) return null
  const caret = el.selectionStart ?? 0
  const before = prompt.slice(0, caret)
  // `@token` at a word boundary, then an optional single trailing space.
  const m = before.match(/(^|\s)@([^\s@]+)(\s?)$/)
  if (!m) return null
  const len = atTokenLength(m[2])
  if (len === null || len !== m[2].length) return null
  const tokenStart = caret - m[0].length + m[1].length
  return prompt.slice(0, tokenStart) + prompt.slice(caret)
}
