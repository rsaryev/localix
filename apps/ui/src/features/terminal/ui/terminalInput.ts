import type { Terminal } from '@xterm/xterm'
import { evaluatePaste } from '../model/terminalPaste'
import { classifyTerminalKey } from '../model/terminalKeymap'

export interface PastePrompt {
  text: string
  lineCount: number
  preview: string
}

/**
 * Guard multi-line pastes: intercept the paste before xterm's own textarea
 * handler (capture phase on the host, which is an ancestor of xterm's helper
 * textarea) so we can strip a trailing newline or confirm a true multi-line
 * paste instead of blindly feeding newlines (command boundaries) to the shell.
 * Returns the listener's disposer.
 */
export function bindTerminalPasteGuard(
  host: HTMLElement,
  term: Terminal,
  confirm: (prompt: PastePrompt) => void,
): () => void {
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text')
    if (!text) return // nothing / non-text — let xterm handle it
    e.preventDefault()
    e.stopPropagation()
    const decision = evaluatePaste(text, term.modes.bracketedPasteMode)
    if (decision.kind === 'paste') {
      term.paste(decision.text)
      return
    }
    confirm({
      text: decision.text,
      lineCount: decision.lineCount,
      preview: decision.preview,
    })
  }
  host.addEventListener('paste', onPaste, true)
  return () => host.removeEventListener('paste', onPaste, true)
}

/**
 * Terminal-scoped hotkeys. Only the chords the terminal itself CLAIMS are
 * swallowed here (find, link palette, clear, prompt-nav);
 * everything else — typing keys AND workspace-level chords (⌘⇧P
 * palette, ⌘B sidebar, ⌘J maximize, F6 focus ring, ⌘⌥P/⌘⌥T switchers) —
 * passes through so those still work from a focused terminal.
 * Routing is the pure, tested `classifyTerminalKey`; this is just the plumbing.
 */
export function attachTerminalHotkeys(
  term: Terminal,
  handlers: {
    find: () => void
    openLinks: () => void
    jumpCommand: (direction: -1 | 1) => void
  },
): void {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const action = classifyTerminalKey(e)
    switch (action) {
      case 'passthrough':
        return true
      case 'find':
        handlers.find()
        break
      case 'open-links':
        handlers.openLinks()
        break
      case 'clear':
        // ⌘/Ctrl+K — clear the screen + scrollback, keeping the current prompt
        // line (the usual terminal "Clear"). `clear()` drops the buffer and
        // promotes the prompt row to the new first line, so the shell keeps its
        // live input intact.
        term.clear()
        break
      case 'jump-prev':
        handlers.jumpCommand(-1)
        break
      case 'jump-next':
        handlers.jumpCommand(1)
        break
    }
    // A claimed chord: swallow it completely. `preventDefault` cancels the
    // browser default; `stopPropagation` stops the WINDOW-level global shortcut
    // handler (`useEditorShortcuts`) from ALSO firing — xterm does neither when
    // we return false, so without stopPropagation ⌘K would still open the global
    // session switcher and ⌘⇧O would open the go-to-symbol palette on top of ours.
    e.preventDefault()
    e.stopPropagation()
    return false
  })
}
