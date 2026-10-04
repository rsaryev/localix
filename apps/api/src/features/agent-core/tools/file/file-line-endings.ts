// ── Line endings + BOM ─────────────────────────────────────────────────────────
//
// Files with CRLF endings or a UTF-8 BOM used to get corrupted by line-based
// editing: matching ran against raw content (so LF-only old_strings missed), and
// splices produced mixed endings. All matching/splicing now happens in LF space
// with the BOM stripped; the original ending and BOM are restored on write.

const BOM = String.fromCharCode(0xfeff)

/** Strip a UTF-8 BOM if present; returns the BOM (or '') and the text without it. */
export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith(BOM) ? { bom: BOM, text: content.slice(1) } : { bom: '', text: content }
}

/** Detect the file's dominant line ending: whichever of \r\n / lone \n appears first. */
export function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIdx = content.indexOf('\r\n')
  const lfIdx = content.indexOf('\n')
  if (lfIdx === -1) return '\n'
  if (crlfIdx === -1) return '\n'
  return crlfIdx < lfIdx ? '\r\n' : '\n'
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function restoreLineEndings(text: string, ending: '\r\n' | '\n'): string {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}
