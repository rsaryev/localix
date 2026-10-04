/**
 * Does this key produce text?
 *
 * The question comes up wherever a surface must decide between "the user is typing" and "the user
 * pressed a shortcut", and every hand-rolled answer in this app got it slightly differently:
 * one checked `tagName === 'INPUT' || 'TEXTAREA'` (missing `contentEditable`), another compared
 * `event.key < '1' || event.key > '9'`. Both are asking about the KEY, not the element, and that is
 * a closed question with one right answer.
 *
 * A key produces text when it is a single character (`a`, `1`, `/`) pressed without a command
 * modifier. Everything else — navigation, editing, function keys, dead keys — does not.
 */

/** Named keys that are a single character but never insert one. */
const NON_WRITING_NAMED_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'Clear',
  'Copy',
  'Cut',
  'Paste',
  'Undo',
  'Redo',
  'ContextMenu',
  'Help',
  'Pause',
  'ScrollLock',
  'NumLock',
  'CapsLock',
  'PrintScreen',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'OS',
  'AltGraph',
  'Dead',
  'Unidentified',
])

export interface TextWritingKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/**
 * True when the keypress cannot insert text, so a surface may treat it as a command.
 *
 * A command modifier makes any key non-writing: the accelerator plus `a` selects, it does not
 * type an `a`.
 */
export function isNonTextWritingKey(event: TextWritingKeyEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (NON_WRITING_NAMED_KEYS.has(event.key)) return true
  if (event.key.startsWith('F') && /^F\d{1,2}$/u.test(event.key)) return true
  // A single code point is the definition of a character key; `Space` is spelled `' '`.
  // Counted via the iterator (not `.length`) so astral-plane characters stay one key.
  let codePoints = 0
  for (const _ of event.key) {
    codePoints += 1
    if (codePoints > 1) return true
  }
  return codePoints !== 1
}
