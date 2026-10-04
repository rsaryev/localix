/**
 * The smallest single-range edit that turns one document into another.
 *
 * `textDocument/didChange` may carry either the whole document or a list of ranged
 * edits, and we were declaring the incremental form while filling it with a
 * full-document replacement — the wire cost of the whole buffer, every sync. At the
 * editor's 150ms debounce that is ~1.04 MB per keystroke-burst for a 1 MB file,
 * measured; roughly 7 MB/s of JSON-RPC for someone simply typing.
 *
 * No client change is needed to fix it: `lsp-client` already keeps the text it last
 * sent for each open document, so the delta can be derived here. A common-prefix /
 * common-suffix scan gives one replacement range, which is exact for the edits an
 * editor actually produces (a typed character, a paste, a formatter rewriting a
 * region) and never wrong for the rest — worst case it degenerates to the whole
 * document, which is what we sent unconditionally before.
 *
 * Offsets are UTF-16 code units, which is what LSP positions mean and what
 * JavaScript string indices already are, so no conversion is involved.
 */

export interface LspPositionLike {
  line: number
  character: number
}

export interface LspTextEditRange {
  start: LspPositionLike
  end: LspPositionLike
}

export interface MinimalEdit {
  range: LspTextEditRange
  text: string
}

/** Line/character of a UTF-16 offset within `text`. */
export function positionAt(text: string, offset: number): LspPositionLike {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 0
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++
      lineStart = i + 1
    }
  }
  return { line, character: clamped - lineStart }
}

/**
 * The single replaced range between `before` and `after`, or `null` when they are
 * identical (nothing to send).
 *
 * The two scans deliberately cannot overlap: a suffix match is not allowed to run
 * back past the point where the prefix match ended, or a repeated character would
 * produce a negative-length range. `"aa" → "aaa"` is the smallest case that trips
 * that, and it is not rare — indentation is made of it.
 */
export function minimalEdit(before: string, after: string): MinimalEdit | null {
  if (before === after) return null

  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++

  let suffix = 0
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix)
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++
  }

  return {
    range: {
      start: positionAt(before, prefix),
      end: positionAt(before, before.length - suffix),
    },
    text: after.slice(prefix, after.length - suffix),
  }
}
