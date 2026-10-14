// Pure matching of an HTML5 drop's `dataTransfer.files` to the absolute FS
// paths the desktop shell reads off the macOS DRAG pasteboard (`dragged_paths`
// command). A browser `File` hides its absolute path; the pasteboard still
// holds the just-dropped files' real paths — but it is a GLOBAL system
// pasteboard that AppKit only clears on the NEXT drag, so its contents may be
// stale (a drag from a browser tab, a previous drop, another app). Matching is
// therefore strict: the drop is trusted only when the pasteboard corresponds
// EXACTLY to the dropped file list — same count, and every file name pairs
// with a distinct entry's basename. Anything less → null, and the caller falls
// back to the path-blind media route (safe, just read-only).

/** One entry from the desktop shell's `dragged_paths` command. */
export interface DraggedPathEntry {
  path: string
  isDir: boolean
}

/** Basename of an absolute path, handling POSIX (`/`) and Windows (`\`) separators. */
export function baseNameFromPath(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : p
}

/** Parse the raw `dragged_paths` invoke result into typed entries (bad shapes → []). */
export function parseDraggedPaths(raw: unknown): DraggedPathEntry[] {
  if (!Array.isArray(raw)) return []
  const entries: DraggedPathEntry[] = []
  for (const item of raw) {
    const rec = item as { path?: unknown; isDir?: unknown } | null
    if (rec && typeof rec.path === 'string' && rec.path.length > 0) {
      entries.push({ path: rec.path, isDir: rec.isDir === true })
    }
  }
  return entries
}

/**
 * Match dropped file names (in `dataTransfer.files` order) to pasteboard
 * entries. Returns one entry per name — in the same order — ONLY when the
 * pasteboard matches the drop exactly (equal count, every name consumes a
 * distinct entry with the same basename); otherwise null. Duplicate basenames
 * pair up positionally (first unconsumed entry with that basename wins), which
 * is correct for a same-order multi-file drop and irrelevant otherwise — a
 * mismatch anywhere rejects the whole set.
 */
export function matchDroppedPaths(
  fileNames: readonly string[],
  entries: readonly DraggedPathEntry[],
): DraggedPathEntry[] | null {
  if (fileNames.length === 0 || fileNames.length !== entries.length) return null
  const unconsumed = [...entries]
  const matched: DraggedPathEntry[] = []
  for (const name of fileNames) {
    const idx = unconsumed.findIndex((e) => baseNameFromPath(e.path) === name)
    if (idx === -1) return null
    matched.push(unconsumed[idx]!)
    unconsumed.splice(idx, 1)
  }
  return matched
}
