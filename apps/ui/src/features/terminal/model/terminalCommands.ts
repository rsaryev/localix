/**
 * Extract a finished command's typed text and its output from the terminal
 * buffer, using the line ranges captured from the OSC 133 semantic-prompt marks
 * (see `shellIntegration.ts`). This backs the exit-code dot's action menu
 * (copy command / copy output / rerun).
 *
 * A command spans three anchors on the physical buffer grid:
 *   inputLine  — the prompt row where the user's input starts (mark `A`/`B`);
 *                `inputStartX` is the column just past the prompt string (`B`).
 *   outputLine — the row where the command's output begins (mark `C`).
 *   endLine    — the row where the command finished (mark `D`).
 *
 * xterm stores physical rows: a long logical line wraps across several rows, each
 * continuation row flagged `wrapped`. We stitch wrapped rows back together (no
 * spurious newline) and only insert a newline at a genuine logical break.
 */

export interface BufferRow {
  text: string
  /** True when this physical row is a soft-wrap continuation of the row above. */
  wrapped: boolean
}

/** Reader over the active buffer by absolute row index. */
export type RowAt = (line: number) => BufferRow

function stitch(rowAt: RowAt, from: number, to: number, firstStartX = 0): string {
  let out = ''
  for (let n = from; n < to; n++) {
    const { text, wrapped } = rowAt(n)
    const seg = n === from ? text.slice(firstStartX) : text
    out += n !== from && !wrapped ? `\n${seg}` : seg
  }
  // Trim per-line trailing spaces (xterm right-pads rows) and drop trailing blanks.
  return out.replace(/[ \t]+$/gm, '').replace(/\n+$/, '')
}

/** The command the user typed, with the prompt stripped from the first row. */
export function extractCommandText(
  rowAt: RowAt,
  inputLine: number,
  inputStartX: number,
  outputLine: number,
): string {
  if (outputLine <= inputLine) return ''
  return stitch(rowAt, inputLine, outputLine, Math.max(0, inputStartX)).trim()
}

/** The command's output (everything between the `C` and `D` marks). */
export function extractOutputText(rowAt: RowAt, outputLine: number, endLine: number): string {
  if (endLine <= outputLine) return ''
  return stitch(rowAt, outputLine, endLine)
}
