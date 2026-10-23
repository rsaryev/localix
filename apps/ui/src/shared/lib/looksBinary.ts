import { hasBinarySignature } from '@localixai/mini-app-sdk/ui/file-types'

/**
 * Heuristic for "this UTF-8 string is actually decoded binary". The backend reads
 * non-image files as UTF-8, so a binary (pdf, zip, wasm…) comes back as mojibake;
 * a NUL byte (the shared git sniff the agent's `read` also applies, so the two never
 * disagree about one file) or a dense run of U+FFFD replacement chars from a botched
 * decode means the file viewer should show a placeholder instead of rendering garbage.
 */
export function looksBinary(text: string): boolean {
  if (hasBinarySignature(text)) return true
  const sample = text.slice(0, 2000)
  if (sample.length === 0) return false
  let bad = 0
  for (let i = 0; i < sample.length; i++) if (sample.charCodeAt(i) === 0xfffd) bad++
  return bad / sample.length > 0.1
}
