/**
 * `read` — the page's visible text, in windows. A long article used to cost an `evaluate` the
 * model had to write; this is one cheap call per window, and the answer says where the window
 * sits in the whole so the caller knows whether to read on. Whitespace is collapsed (the
 * model pays per character). It only observes: it never touches the page.
 */
import type { VfCommand } from '../protocol/index'
import { fail } from './target'
import type { ActuateDeps, ActuateResult } from './types'

/** Characters of text one `read` returns. */
export const READ_LIMIT = 8000

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

export function performRead(cmd: VfCommand, deps: ActuateDeps): ActuateResult {
  const requested = cmd.offset ?? 0
  if (!Number.isInteger(requested) || requested < 0)
    return fail('bad_request', '`offset` must be a whole number of characters, 0 or more.')
  const el = (deps.root ?? document.body) as HTMLElement | null
  const text = (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const offset = Math.min(requested, text.length)
  let end = Math.min(offset + READ_LIMIT, text.length)
  // Never cut an emoji in half: the next window starts at `end`.
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1
  return {
    ok: true,
    result: { action: 'read', read: { text: text.slice(offset, end), offset, total: text.length } },
  }
}
