/**
 * Pure key-name normalization — NO DOM, so the page-side actuate (synthetic
 * KeyboardEvents in the injected probe) has ONE alias map. The agent may send short
 * names ("Up", "Esc", "Return"); they normalize to the canonical `event.key` games
 * listen for.
 */

/** Short aliases → the canonical `event.key`. */
export const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  space: ' ',
  spacebar: ' ',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  arrowup: 'ArrowUp',
  up: 'ArrowUp',
  arrowdown: 'ArrowDown',
  down: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  left: 'ArrowLeft',
  arrowright: 'ArrowRight',
  right: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

/** Canonical name for a single key (not a chord); unknown keys/chars pass through. */
export function normalizeKeyName(key: string): string {
  return NAMED_KEYS[key.toLowerCase()] ?? key
}
