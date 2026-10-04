/**
 * Maps human key names → the raw bytes a PTY expects, so the model can press
 * `["Down","Down","Enter"]` or `"Ctrl+C"` instead of hand-emitting escape codes.
 * Pure data + string work — the encoded bytes go straight to `session.write`
 * (the same native PTY input path the UI uses), no emulator involved.
 *
 * Anything that isn't a recognized key name passes through literally, so a
 * sequence like `["i", "hello", "Escape", ":wq", "Enter"]` works as written.
 */

/** Named key → escape/control bytes (xterm / VT100 conventions). */
const NAMED_KEYS: Record<string, string> = {
  enter: '\r',
  return: '\r',
  tab: '\t',
  backtab: '\x1b[Z', // Shift+Tab — navigate fields/menus backwards
  shifttab: '\x1b[Z',
  escape: '\x1b',
  esc: '\x1b',
  backspace: '\x7f',
  delete: '\x1b[3~',
  del: '\x1b[3~',
  insert: '\x1b[2~',
  space: ' ',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pgup: '\x1b[5~',
  pagedown: '\x1b[6~',
  pgdn: '\x1b[6~',
  f1: '\x1bOP',
  f2: '\x1bOQ',
  f3: '\x1bOR',
  f4: '\x1bOS',
  f5: '\x1b[15~',
  f6: '\x1b[17~',
  f7: '\x1b[18~',
  f8: '\x1b[19~',
  f9: '\x1b[20~',
  f10: '\x1b[21~',
  f11: '\x1b[23~',
  f12: '\x1b[24~',
}

/** Encode a single key token to its bytes. */
function encodeKey(token: string): string {
  const named = NAMED_KEYS[token.toLowerCase()]
  if (named !== undefined) return named

  // Ctrl+<char>: control char (Ctrl+C → \x03, Ctrl+A → \x01).
  const ctrl = /^ctrl\+(.)$/i.exec(token)
  if (ctrl) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) & 0x1f)

  // Alt+<char>: ESC prefix then the char (meta convention).
  const alt = /^alt\+(.)$/i.exec(token)
  if (alt) return '\x1b' + alt[1]

  // Tolerate separators in multi-word key names: "Shift+Tab" / "Page Up" /
  // "page_up" → backtab / pageup. (Checked AFTER ctrl/alt so "Ctrl+C" keeps its
  // modifier handling.)
  const normalized = NAMED_KEYS[token.toLowerCase().replace(/[\s+_-]/g, '')]
  if (normalized !== undefined) return normalized

  // Not a key name — literal text (lets ["i","hello",":wq"] pass through).
  return token
}

/** Encode an ordered list of key tokens into one byte string for the PTY. */
export function encodeKeys(keys: string[]): string {
  return keys.map(encodeKey).join('')
}
