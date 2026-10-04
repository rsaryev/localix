/**
 * Terminal-noise sanitizer for the MODEL-facing bash output, and the server's ONE ANSI stripper.
 *
 * Commands run under a shell frequently emit terminal control data — color/
 * cursor CSI sequences, OSC title/hyperlink payloads, `\r`-rewritten progress
 * bars — that carries zero information for the model but burns tokens and can
 * even smuggle instructions (OSC/DCS payloads are free-form text). This strips
 * exactly the ECMA-48 escape grammar and nothing else: plain unicode, box
 * drawing, emoji etc. pass through untouched.
 *
 * Hand-written regex sets for this drifted apart across the server (each missed a different form:
 * unterminated OSC payloads leaking, DCS/APC bodies, 8-bit C1 CSI `\x9b`, a CSI cut mid-stream),
 * so the grammar is Bun's native `Bun.stripANSI`, which covers all of them: an OSC/DCS/SOS/PM/APC
 * payload is removed whole, terminated by BEL or ST or by the end of the text (output cut
 * mid-stream does not leak its payload), and a lone ESC is dropped.
 */
export function stripAnsi(text: string): string {
  return Bun.stripANSI(text)
}

/**
 * Collapse `\r`-rewritten progress lines to their FINAL rendered state: a
 * progress bar redrawn 500 times is one logical line, not 500. Per visual
 * line (split on `\n`), only the text after the last `\r` survives — the
 * terminal-emulation approximation every CI log processor uses. CRLF line
 * endings are preserved as plain lines: the trailing `\r` of `\r\n` is
 * stripped FIRST so it is never mistaken for a rewrite that cleared the line.
 */
export function collapseCarriageReturns(text: string): string {
  if (!text.includes('\r')) return text
  return text
    .split('\n')
    .map((line) => {
      const noCrlf = line.replace(/\r+$/, '')
      const last = noCrlf.lastIndexOf('\r')
      return last === -1 ? noCrlf : noCrlf.slice(last + 1)
    })
    .join('\n')
}
