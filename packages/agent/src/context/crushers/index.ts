/**
 * Structural crushers — content-aware compression for NON-recoverable tool output
 * (bash/build/test logs, JSON from CLIs). Unlike generic head/tail truncation, a
 * crusher understands the shape (JSON array → hoist constants + keep head/tail rows;
 * log → keep errors + stack + verdict, drop noise), so it keeps far more signal per
 * kept token. All crushers are pure; recoverable read results are NOT crushed (the
 * pipeline elides those to re-readable pointers instead).
 */
import { crushJsonArray } from './json'
import { crushLog } from './log'
import type { CrushResult } from './types'

import { carriesMarker } from '../op-menu'

export { crushJsonArray } from './json'
export { crushLog } from './log'
export type { CrushResult } from './types'

/** Idempotency marker: content already carrying it is never re-crushed. */
export const CRUSH_MARKER = 'crushed to save context'

/**
 * Best-effort structural crush of a non-recoverable tool result. Tries JSON first
 * (parses fast, bails if not a crushable array), then line-oriented log crushing.
 * Returns the crushed text WITH an idempotency header, or `null` if neither applies
 * (caller falls back to generic truncation).
 */
export function crushNonRecoverable(
  text: string,
  opts: { locator?: string; recoveryToolAvailable?: boolean } = {},
): CrushResult | null {
  if (carriesMarker(text, CRUSH_MARKER)) return null
  const r = crushJsonArray(text) ?? crushLog(text)
  if (!r) return null
  // When the caller knows the originating tool_call_id, advertise that the FULL
  // original is recoverable (the `tool_output` tool reads it back from the
  // durable message store) — this is what makes the crush safe to apply.
  const recover =
    opts.locator && opts.recoveryToolAvailable !== false
      ? `; full original retrievable via tool_output(action="get", tool_call_id="${opts.locator}")`
      : ''
  const header = `[${CRUSH_MARKER} — ${r.beforeChars}→${r.afterChars} chars, structure preserved${recover}]`
  return { ...r, text: `${header}\n${r.text}`, afterChars: header.length + 1 + r.afterChars }
}
