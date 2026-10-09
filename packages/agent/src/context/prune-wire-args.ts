import type { ToolCall } from '../types'
import { carriesMarker, ELISION_MARKER } from './compression-markers'
import { elidedPointer } from './pointers'
import { ALL_MUTATE_TOOLS, NONIDEMPOTENT_TOOLS } from './tool-classes'
import {
  truncateMiddle,
  MIDDLE_TRUNCATE_THRESHOLD,
  MIDDLE_TRUNCATE_MARKER,
} from './prune-wire-output'

export function elideToolCallArgs(
  tc: ToolCall,
  minChars: number,
  failedToolCallIds: ReadonlySet<string>,
  recoveryToolAvailable: boolean,
): ToolCall | undefined {
  // A FAILED mutation never reached disk, so its content/patch args are NOT
  // recoverable by re-reading — eliding them would lose the intended-but-
  // unapplied change irrecoverably (same rule as VBC's heavyMutateInputs).
  if (failedToolCallIds.has(tc.id)) return undefined
  const args = tc.arguments
  if (!args || typeof args !== 'object') return undefined
  const a = args as Record<string, unknown>

  // Non-recoverable tools (bash/terminal): a VERY large command arg is almost
  // always a heredoc writing a file (`cat > f <<EOF …EOF`). Unlike a `write`
  // call's content (a recoverable mutate arg, pointer-elided below), a bash
  // command isn't pointer-recoverable AND was never bounded at all — so the whole
  // body replayed every turn for the rest of the session. Head/tail bound it,
  // mirroring how the bash OUTPUT is bounded: the command head (what ran) + tail
  // (the closing EOF / trailing command) survive, the heredoc bulk is dropped.
  if (NONIDEMPOTENT_TOOLS.has(tc.name)) {
    const cmd = a.command
    if (
      typeof cmd === 'string' &&
      cmd.length > MIDDLE_TRUNCATE_THRESHOLD &&
      !carriesMarker(cmd, MIDDLE_TRUNCATE_MARKER)
    ) {
      return { ...tc, arguments: { ...a, command: truncateMiddle(cmd) } }
    }
    return undefined
  }

  if (!ALL_MUTATE_TOOLS.has(tc.name)) return undefined
  // Elide EVERY heavy recoverable field, not just the first hit — an `edit` call
  // can carry both old_string and new_string above the threshold.
  let next: Record<string, unknown> | undefined
  for (const field of ['content', 'patch', 'old_string', 'new_string'] as const) {
    const v = a[field]
    if (typeof v === 'string' && v.length > minChars && !carriesMarker(v, ELISION_MARKER)) {
      next = {
        ...(next ?? a),
        [field]: elidedPointer(field, v.length, tc.id, v, recoveryToolAvailable),
      }
    }
  }
  if (Array.isArray(a.edits)) {
    const json = JSON.stringify(a.edits)
    if (json.length > minChars && !carriesMarker(json, ELISION_MARKER)) {
      next = {
        ...(next ?? a),
        edits: elidedPointer('edits', json.length, tc.id, json, recoveryToolAvailable),
      }
    }
  }
  return next ? { ...tc, arguments: next } : undefined
}
