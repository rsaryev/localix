/**
 * What a status line command printed, made safe to hand to a screen: each printed row stays its
 * own row (joined with `\n`), and of the escape sequences only what the screen draws survives —
 * SGR colors and styles (`ESC [ … m`) and OSC 8 hyperlinks (always ended by ST, `ESC \`). Cursor moves, screen clears, window
 * titles and every other control byte are dropped, so a script cannot move or rewrite anything
 * but its own text. Spacing inside a row is kept: a bar or a column is laid out with it.
 */

const MAX_ROWS = 12
const MAX_ROW_CHARS = 2_000

const SEQUENCE =
  // oxlint-disable-next-line no-control-regex -- parses terminal escapes to keep the safe ones
  /\u001b(?:\[([0-?]*)[ -/]*([@-~])|\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)?|[@-Z\\-_]|[\s\S])/g
// oxlint-disable-next-line no-control-regex -- C0 controls and DEL are never presentation text
const CONTROL = /[\u0000-\u0009\u000b-\u001a\u001c-\u001f\u007f]/g

function keepSafe(_whole: string, csi?: string, final?: string, osc?: string): string {
  if (final === 'm' && csi !== undefined && /^[0-9;:]*$/.test(csi)) return `\u001b[${csi}m`
  if (osc?.startsWith('8;')) return `\u001b]${osc}\u001b\\`
  return ''
}

/** The rows of `stdout` for the screen, `\n` between them; undefined when nothing is visible. */
export function statusLineRows(stdout: string, padding = 0): string | undefined {
  const text = stdout
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(SEQUENCE, keepSafe)
    .replace(CONTROL, '')
  const visible = (row: string) =>
    // oxlint-disable-next-line no-control-regex -- measures a row without its kept escapes
    row.replace(/\u001b\[[0-9;:]*m|\u001b\][^\u001b]*\u001b\\/g, '').trim() !== ''
  const rows = text.split('\n').map((row) => row.trimEnd())
  while (rows.length > 0 && !visible(rows[0]!)) rows.shift()
  while (rows.length > 0 && !visible(rows[rows.length - 1]!)) rows.pop()
  if (rows.length === 0) return undefined
  const indent = ' '.repeat(Math.max(0, Math.floor(padding)))
  return rows
    .slice(0, MAX_ROWS)
    .map((row) => `${indent}${row.slice(0, MAX_ROW_CHARS)}`)
    .join('\n')
}
