// INPUT REPAIR for apply_patch: everything that turns what a model actually sent
// into the canonical "*** Begin Patch … *** End Patch" envelope the parser reads.
// Independent repairs — transport unwrapping, concatenated-envelope splicing,
// and raw unified/git-diff translation. Pure string processing; the parser
// (patch-parse.ts) applies them before it reads a line.

import {
  ADD_FILE,
  BEGIN_PATCH,
  DELETE_FILE,
  DIFF_META,
  END_PATCH,
  MOVE_TO,
  UPDATE_FILE,
  normalizeMarker,
  startsWithMarker,
  stripABPrefix,
} from './patch-syntax'
import { plural } from '../tool-output'

/** Unwrap a ```-fenced patch body (models fence the envelope as if it were code). */
export function stripCodeFence(text: string): string {
  const t = text.trim()
  if (!t.startsWith('```')) return text
  const lines = t.split(/\r?\n/)
  // Drop the opening fence line (``` optionally followed by a language tag).
  lines.shift()
  // Drop a trailing closing fence if present.
  if ((lines[lines.length - 1] ?? '').trim() === '```') lines.pop()
  return lines.join('\n')
}

/**
 * Unwrap transport syntax that models sometimes put inside the `patch` string.
 *
 * The tool input is already a string, but weaker models occasionally serialize
 * that string one more time, serialize the whole `{ patch: ... }` object into it,
 * or copy the heredoc form used by shell-based apply_patch implementations.
 * These wrappers are unambiguous and carry no patch semantics, so remove them
 * before validating the envelope. The bounded loop also handles combinations
 * such as a JSON-stringified fenced patch without making malformed prose valid.
 */
export function unwrapPatchPayload(text: string): string {
  let current = text.trim()

  for (let depth = 0; depth < 3; depth += 1) {
    const before = current
    current = stripCodeFence(current).trim()

    try {
      const decoded: unknown = JSON.parse(current)
      if (typeof decoded === 'string') {
        current = decoded.trim()
      } else if (
        decoded !== null &&
        typeof decoded === 'object' &&
        typeof (decoded as { patch?: unknown }).patch === 'string'
      ) {
        current = (decoded as { patch: string }).patch.trim()
      }
    } catch {
      // Most patches are not JSON. Continue with the other wrapper forms.
    }

    const lines = current.split(/\r?\n/)
    const opener = /^(?:apply_patch\s+)?<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/.exec(
      (lines[0] ?? '').trim(),
    )
    if (opener && lines.length >= 3 && (lines[lines.length - 1] ?? '').trim() === opener[2]) {
      current = lines.slice(1, -1).join('\n').trim()
    }

    if (current === before) break
  }

  return current
}

// Some models emit several back-to-back envelopes (one "*** Begin Patch" /
// "*** End Patch" pair per logical change) instead of a single envelope with N
// file headers. Both express the same intent, so splice out every *interior*
// "*** End Patch" immediately followed by a "*** Begin Patch" — collapsing the
// concatenated envelopes into one before the main parse. The outermost
// Begin/End pair (and the single-envelope path) is left untouched.
export function mergeConcatenatedEnvelopes(text: string): string {
  const lines = text.split(/\r?\n/)
  const isBegin = (s: string) => normalizeMarker(s) === normalizeMarker(BEGIN_PATCH)
  const isEnd = (s: string) => normalizeMarker(s) === normalizeMarker(END_PATCH)
  const out: string[] = []
  let seenBegin = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    // Drop an interior "*** End Patch" that is directly followed (ignoring blank
    // lines) by another "*** Begin Patch", along with that "*** Begin Patch".
    if (isEnd(line)) {
      let j = i + 1
      while (j < lines.length && !(lines[j] ?? '').trim()) j += 1
      if (j < lines.length && isBegin(lines[j] ?? '')) {
        i = j // skip both the interior End and the following Begin
        continue
      }
    }
    // A restated "*** Begin Patch" (no interior End before it) is ceremony, not a
    // directive — the envelope is already open. Only once one has been seen, so a
    // preamble before the FIRST marker is still stripped by the caller.
    if (isBegin(line)) {
      if (seenBegin) continue
      seenBegin = true
    }
    out.push(line)
  }
  return out.join('\n')
}

/** The `---`/`+++`/`rename`/`diff --git` header block that opens one diff file section. */
interface DiffFileHeader {
  oldPath?: string
  newPath?: string
}

/** Consume the header lines of one diff file block, starting at `start`. */
function readDiffFileHeader(
  raw: string[],
  start: number,
): { header: DiffFileHeader; next: number } {
  const header: DiffFileHeader = {}
  let i = start
  while (i < raw.length) {
    const h = raw[i] ?? ''
    const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(h)
    const from = /^rename from (.+)$/.exec(h)
    const to = /^rename to (.+)$/.exec(h)
    const minus = /^--- (.+)$/.exec(h)
    const plus = /^\+\+\+ (.+)$/.exec(h)
    if (git) {
      header.oldPath ??= git[1]
      header.newPath ??= git[2]
    } else if (from) header.oldPath = from[1]
    else if (to) header.newPath = to[1]
    else if (minus) header.oldPath = minus[1].trim()
    else if (plus) header.newPath = plus[1].trim()
    else if (!DIFF_META.test(h)) break
    i += 1
  }
  return { header, next: i }
}

/** Consume one diff file block's body (up to the next file block), starting at `start`. */
function readDiffFileBody(raw: string[], start: number): { body: string[]; next: number } {
  const body: string[] = []
  let i = start
  while (i < raw.length) {
    const b = raw[i] ?? ''
    if (b.startsWith('diff --git ')) break
    if (b.startsWith('--- ') && (raw[i + 1] ?? '').startsWith('+++ ')) break
    i += 1
    if (b.startsWith('\\ No newline at end of file')) continue
    if (startsWithMarker(b)) continue // stray "*** Begin/End Patch" around the diff
    body.push(b)
  }
  return { body, next: i }
}

// The single most common apply_patch failure (27% of its calls, mostly weak
// models): the model emits a plain `git diff` / unified diff with no
// "*** Update File:" directives — sometimes even without the envelope. The
// target path is right there in the "diff --git" / "---" / "+++" headers, so
// REJECTING it burns a whole turn to teach syntax we can simply infer.
//
// Only runs when the input carries NO file directive at all: a patch that has
// even one "*** Update File:" is already handled by isDiffFileHeader() skipping
// wrapped-diff metadata inside a section, and a stray header there stays an error.
// Returns the equivalent envelope text, or null when there is nothing to convert.
export function synthesizeEnvelopeFromUnifiedDiff(text: string, notes?: string[]): string | null {
  if (/^\s*\*\*\*\s*(add|update|delete)\s+file/im.test(text)) return null
  const raw = text.split(/\r?\n/)
  if (!raw.some((l) => /^(diff --git |--- |\+\+\+ )/.test(l))) return null

  const out: string[] = [BEGIN_PATCH]
  let files = 0
  let i = 0
  while (i < raw.length) {
    const line = raw[i] ?? ''
    if (!(DIFF_META.test(line) || line.startsWith('--- '))) {
      i += 1 // envelope markers, blank lines, prose before the first file block
      continue
    }

    const { header, next } = readDiffFileHeader(raw, i)
    i = next
    const { oldPath, newPath } = header

    // Both sides must be named: a lone "--- a/x" is a malformed diff, not a delete.
    if (oldPath === undefined || newPath === undefined) continue
    const oldClean = oldPath === '/dev/null' ? undefined : stripABPrefix(oldPath)
    const newClean = newPath === '/dev/null' ? undefined : stripABPrefix(newPath)
    if (!oldClean && !newClean) continue

    const body = readDiffFileBody(raw, i)
    i = body.next
    const hasHunk = body.body.some((b) => b.trim().length > 0)

    files += 1
    if (!oldClean) {
      out.push(`${ADD_FILE}${newClean}`, ...body.body)
    } else if (!newClean) {
      // A Delete carries no hunks the parser can use — its "-" lines would parse
      // as a bogus top-level directive.
      out.push(`${DELETE_FILE}${oldClean}`)
    } else if (!hasHunk) {
      // Pure rename (`similarity index 100%`) or a binary blob: no content to apply.
      if (newClean !== oldClean) out.push(`${MOVE_TO}${oldClean} -> ${newClean}`)
      else files -= 1
    } else {
      out.push(`${UPDATE_FILE}${oldClean}`)
      if (newClean !== oldClean) out.push(`${MOVE_TO}${newClean}`)
      out.push(...body.body)
    }
  }

  if (files === 0) return null
  out.push(END_PATCH)
  notes?.push(
    `note: normalized a unified/git diff into the apply_patch envelope (${plural(files, 'file')})`,
  )
  return out.join('\n')
}
