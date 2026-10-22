// ── Line endings + BOM ─────────────────────────────────────────────────────────
//
// Files with CRLF endings or a UTF-8 BOM used to get corrupted by line-based
// editing: matching ran against raw content (so LF-only old_strings missed), and
// splices produced mixed endings. All matching/splicing now happens in LF space
// with the BOM stripped; the original ending and BOM are restored on write.

const BOM = String.fromCharCode(0xfeff)

type LineEnding = '\r\n' | '\n'

/** Strip a UTF-8 BOM if present; returns the BOM (or '') and the text without it. */
export function stripBom(content: string): { bom: string; text: string } {
  const bom = content.startsWith(BOM) ? BOM : ''
  return { bom, text: content.slice(bom.length) }
}

/** The file's dominant line ending: the one its first line ends with. */
export function detectLineEnding(content: string): LineEnding {
  const firstBreak = content.indexOf('\n')
  return firstBreak > 0 && content[firstBreak - 1] === '\r' ? '\r\n' : '\n'
}

/** Every CRLF and lone CR as LF. */
export function normalizeToLF(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function restoreLineEndings(text: string, ending: LineEnding): string {
  return ending === '\n' ? text : text.replace(/\n/g, '\r\n')
}
