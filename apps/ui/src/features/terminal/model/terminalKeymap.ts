// Pure key-routing for a focused terminal pane. Given a keydown, decide which
// (if any) terminal-scoped affordance the chord claims. Kept side-effect-free so
// the routing table is unit-testable in isolation from xterm / the DOM.
//
// A CLAIMED chord is handled terminal-side and must be swallowed completely
// (preventDefault + stopPropagation) so the WINDOW-level global shortcut handler
// (`useEditorShortcuts`) never *also* fires — xterm's `attachCustomKeyEventHandler`
// does neither on our behalf when we return false, so without stopPropagation a
// chord like ⌘⇧O would open BOTH the terminal link picker and the global
// go-to-symbol palette, and ⌘K (the global `switchSession` chord) would open the
// session switcher instead of clearing the terminal.
//
// `passthrough` = the terminal does NOT claim the key: xterm handles it (typing →
// PTY) and the event is free to bubble to the window-level workspace shortcuts
// (⌘⇧P palette, ⌘B sidebar, ⌘J maximize, F6 focus ring, ⌘⌥P/⌘⌥T switchers, …),
// which SHOULD still work from a focused terminal.

import { isPrimaryModifier } from '@/shared/lib/keybindings'

export interface TerminalKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type TerminalKeyAction =
  | 'find' // ⌘/Ctrl+F — in-terminal find widget
  | 'open-links' // ⌘/Ctrl+⇧+O — detected-link quickpick
  | 'clear' // ⌘/Ctrl+K — clear screen + scrollback (keep current prompt line)
  | 'jump-prev' // ⌘/Ctrl+↑ — jump to the previous command prompt
  | 'jump-next' // ⌘/Ctrl+↓ — jump to the next command prompt
  | 'passthrough' // not claimed — let xterm / the global shortcuts handle it

/** Map a terminal-pane keydown to the affordance it claims (`passthrough` if none). */
export function classifyTerminalKey(e: TerminalKeyEvent): TerminalKeyAction {
  const mod = isPrimaryModifier(e)
  // Everything else the terminal claims is a mod-chord WITHOUT Alt (Alt-chords are
  // the shell's — word-nav etc.). Bare keys and Alt-chords pass straight through.
  if (!mod || e.altKey) return 'passthrough'

  if (!e.shiftKey && (e.key === 'f' || e.key === 'F')) return 'find'
  if (e.shiftKey && (e.key === 'o' || e.key === 'O')) return 'open-links'
  // ⌘/Ctrl+K — clear. Claimed terminal-side so the global session-switcher
  // (default `mod+k`) can't hijack it while the terminal is focused. On mac ⌘K
  // is the usual terminal "Clear"; Ctrl+K (readline kill-line) is a distinct
  // chord and stays with the shell.
  if (!e.shiftKey && (e.key === 'k' || e.key === 'K')) return 'clear'
  if (!e.shiftKey && e.key === 'ArrowUp') return 'jump-prev'
  if (!e.shiftKey && e.key === 'ArrowDown') return 'jump-next'

  return 'passthrough'
}
