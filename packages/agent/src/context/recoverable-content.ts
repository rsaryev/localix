/**
 * Recoverable tool I/O: the heavy payloads a context op may collapse to a pointer because the
 * same text can be re-read from disk — a mutation call's args and a read-class call's result.
 */
import { isFileChangeItem, type ToolBackedItem } from '../agents/items'
import { itemResultModelText } from '../utils/prune-messages'
import { carriesMarker, ELISION_MARKER } from './compression-markers'
import { READ_RESULT_TOOLS } from './tool-classes'

/**
 * The heavy, recoverable string payloads a mutation tool call carries in its ARGS:
 * the `write`/`edit` content, the `apply_patch` body, an `edit`'s edits array, a `write`'s
 * files array, or the historical single-edit shape (`old_string`/`new_string`). Returns the input
 * field names + texts so they can be measured and elided (the resulting file state
 * is on disk — re-readable).
 */
export function heavyMutateInputs(item: ToolBackedItem): Array<{ field: string; text: string }> {
  if (item.status !== 'completed') return []
  // A file_change that COMPLETED but has any FAILED hunk did not write those changes
  // to disk, so the patch/content args are NOT recoverable by re-reading. Keep them
  // verbatim: `ToolOutput` serves a heavy input back only when this helper reports
  // it, so eliding here would make the pointer promise a recovery of text the model
  // would then have to re-derive.
  if (isFileChangeItem(item) && item.changes.some((c) => c.failed)) return []
  const name = item.name
  const input = item.input as Record<string, unknown> | undefined
  if (!input || typeof input !== 'object') return []
  const out: Array<{ field: string; text: string }> = []
  const pushString = (field: string) => {
    const v = input[field]
    if (typeof v === 'string' && v && !carriesMarker(v, ELISION_MARKER))
      out.push({ field, text: v })
  }
  if (name === 'Write' || name === 'Edit') pushString('content')
  if (name === 'apply_patch' || name === 'patch') pushString('patch')
  // A batched call carries its payload as an array: `edit`'s `edits`, `write`'s `files`.
  const pushArray = (field: 'edits' | 'files') => {
    const v = input[field]
    if (!Array.isArray(v) || !v.length) return
    const text = JSON.stringify(v)
    if (!carriesMarker(text, ELISION_MARKER)) out.push({ field, text })
  }
  if (name === 'Write') pushArray('files')
  if (name === 'Edit') {
    pushArray('edits')
    // single-edit shorthand: old_string/new_string at the top level
    pushString('old_string')
    pushString('new_string')
  }
  return out
}

/** The recoverable result text of a read-class tool item (re-readable), if any. */
export function recoverableReadResult(item: ToolBackedItem): string | undefined {
  if (item.status !== 'completed') return undefined
  if (!READ_RESULT_TOOLS.has(item.name)) return undefined
  const t = itemResultModelText(item)
  if (!t.length || carriesMarker(t, ELISION_MARKER)) return undefined // empty or already elided
  return t
}
