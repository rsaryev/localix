// Pure application of LSP TextEdits to a document, and the contract for edits
// that belong to an editor's LIVE buffer rather than to the file on disk.
//
// Exported as the `@localixai/api/lsp-edits` leaf: the server computes these
// edits and the browser applies them, and two copies of the offset math or the
// digest would drift into a silently corrupted buffer. So this module imports
// nothing — the browser links against exactly this file.
//
// LSP positions are UTF-16 line/character pairs and JS strings are UTF-16, so
// `character` maps directly to a code-unit offset within the line.

/** One LSP TextEdit — structurally `LspTextEdit` (`lsp-protocol.ts`), restated so this leaf imports nothing. */
export interface TextEditLike {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  newText: string
}

/**
 * Edits for a document an editor holds OPEN, to be applied to that editor's buffer.
 *
 * A language server computes every range against the document it was last sent — the
 * editor's unsaved buffer, not the bytes on disk. Writing those edits to disk applied
 * them to the wrong text whenever the buffer was dirty, and the editor then saw "disk
 * changed under unsaved edits" and raised its reconcile banner for a fix the person had
 * just asked for. So an open document's edits travel back to its buffer, and `digest` names the exact text
 * they were computed against: a buffer that has moved on since refuses them rather than
 * splicing ranges into different text.
 */
export interface BufferEdit {
  file: string
  digest: string
  edits: TextEditLike[]
}

/**
 * Non-cryptographic fingerprint of a document's text (FNV-1a 32 + length). It only has
 * to tell "the text these edits were computed against" from "text that has moved on",
 * and `Math.imul` keeps it a cheap linear scan on large buffers.
 */
export function textDigest(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${content.length}`
}

/** Byte-independent offset of the first char of each line (handles \n, \r\n, \r). */
function lineStartOffsets(text: string): number[] {
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      offsets.push(i + 1)
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        offsets.push(i + 2)
        i++
      } else {
        offsets.push(i + 1)
      }
    }
  }
  return offsets
}

function positionToOffset(
  textLength: number,
  starts: number[],
  pos: { line: number; character: number },
): number {
  if (pos.line >= starts.length) return textLength
  return Math.min(starts[pos.line] + Math.max(pos.character, 0), textLength)
}

/**
 * Apply a set of {@link TextEditLike}s to `text`. Edits are resolved to absolute
 * offsets up-front and applied DESCENDING by start position, so splicing one edit
 * never invalidates the offsets of the edits still pending (LSP guarantees edits
 * within one file don't overlap).
 */
export function applyTextEdits(text: string, edits: readonly TextEditLike[]): string {
  if (!edits.length) return text
  const starts = lineStartOffsets(text)
  const resolved = edits.map((e) => ({
    start: positionToOffset(text.length, starts, e.range.start),
    end: positionToOffset(text.length, starts, e.range.end),
    newText: e.newText,
  }))
  resolved.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  for (const e of resolved) out = out.slice(0, e.start) + e.newText + out.slice(e.end)
  return out
}
