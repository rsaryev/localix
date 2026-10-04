export type PatchSegmentKind = 'add' | 'modify' | 'delete' | 'rename'

export interface PatchFileSegment {
  /** Target path (post-move for renames). */
  path: string
  kind: PatchSegmentKind
  /** The file's hunk body (`+`/`-`/` ` lines) — feed straight to `DiffView`. */
  body: string
}

const HEADER_RE = /^\*\*\*\s+(Add File|Update File|Delete File|Move to):?\s*(.*)$/

/**
 * Parse (possibly PARTIAL, mid-stream) apply_patch text into per-file segments for
 * live rendering. Tolerant of a half-streamed tail: a segment appears as soon as its
 * `*** … File:` header line is complete, and body lines accumulate as they arrive.
 *
 * - `*** Move to:` renames the file currently being described (it is a modifier of the
 *   preceding `*** Update File:`, not a new target).
 * - The `*** Begin/End Patch` envelope and `@@` section markers are dropped so only the
 *   actual +/-/context lines reach the diff renderer — that's the difference between the
 *   raw "system diff" the user saw and a clean per-file diff.
 */
export function parseApplyPatch(patch: string): PatchFileSegment[] {
  const segments: { path: string; kind: PatchSegmentKind; body: string[] }[] = []
  let current: { path: string; kind: PatchSegmentKind; body: string[] } | null = null

  for (const line of patch.split('\n')) {
    const header = HEADER_RE.exec(line)
    if (header) {
      const label = header[1]
      const path = header[2].trim()
      if (label === 'Move to') {
        if (current) {
          current.kind = 'rename'
          if (path) current.path = path
        }
        continue
      }
      if (!path) continue // header line still being typed — wait for the path
      current = {
        path,
        kind: label === 'Add File' ? 'add' : label === 'Delete File' ? 'delete' : 'modify',
        body: [],
      }
      segments.push(current)
      continue
    }
    // Any other `***` line is a directive we don't render as content: the
    // Begin/End Patch envelope, or a header whose tail is still streaming in.
    if (line.startsWith('***')) continue
    if (line.startsWith('@@')) continue // hunk section marker — noise for the clean view
    if (current) current.body.push(line)
  }

  // Trim a trailing blank tail so a freshly-opened segment renders nothing rather than
  // an empty "context" line, but keep interior blanks (they're real content).
  return segments.map((s) => {
    const body = s.body.join('\n').replace(/\n+$/, '')
    return { path: s.path, kind: s.kind, body }
  })
}
