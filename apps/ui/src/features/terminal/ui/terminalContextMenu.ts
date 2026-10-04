import { ClipboardPaste, Copy, Eraser, Link2, Search, TextSelect } from 'lucide-react'
import type { Terminal } from '@xterm/xterm'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import { toast } from '@/shared/lib/notify'
import { formatChordText } from '@/shared/lib/keybindings'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { evaluatePaste, type PasteDecision } from '../model/terminalPaste'

/**
 * The terminal's right-click menu — the one context menu every terminal emulator has, and the
 * only surface in this workbench where its absence was total: the desktop shell suppresses the
 * browser's own menu, so a right-click over the grid simply did nothing.
 *
 * Built FRESH on each open rather than memoized, because two rows depend on state xterm owns and
 * React never sees: whether there is a selection right now, and what the clipboard holds. A list
 * captured at render time offers Copy over an empty selection.
 *
 * Paste goes through the SAME `evaluatePaste` guard as ⌘V instead of shortcutting to
 * `term.paste`, so the menu cannot feed command boundaries to the shell that the keyboard path
 * would have stopped and asked about.
 */
export interface TerminalMenuOps {
  term: Terminal | null
  /** Commit an approved paste through xterm, so bracketed-paste framing is honored. */
  paste: (text: string) => void
  /** Raise the multi-line confirm the keyboard path uses. */
  confirmPaste: (decision: Extract<PasteDecision, { kind: 'confirm' }>) => void
  openFind: () => void
  openLinks: () => void
}

export function terminalContextMenu(ops: TerminalMenuOps): MenuEntry[] {
  const { term } = ops
  const selection = term?.getSelection() ?? ''
  return [
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      disabled: selection.length === 0,
      onSelect: () => void copyText(selection, 'Selection'),
    },
    { id: 'paste', label: 'Paste', icon: ClipboardPaste, onSelect: () => void readAndPaste(ops) },
    { id: 'select-all', label: 'Select all', icon: TextSelect, onSelect: () => term?.selectAll() },
    { separator: true },
    { id: 'find', label: 'Find…', icon: Search, onSelect: ops.openFind },
    { id: 'links', label: 'Open link…', icon: Link2, onSelect: ops.openLinks },
    { separator: true },
    {
      id: 'clear',
      // Not `danger`: this drops the scrollback, not the session, and every terminal treats it as
      // an ordinary command.
      label: 'Clear',
      icon: Eraser,
      onSelect: () => {
        term?.clear()
        term?.focus()
      },
    },
  ]
}

async function readAndPaste(ops: TerminalMenuOps): Promise<void> {
  const { term } = ops
  if (!term) return
  let text: string | null
  try {
    text = await platformCapabilities().clipboard.readText()
  } catch {
    // A denied clipboard READ is the browser's answer, not a terminal failure — the keyboard path
    // still works, because a paste EVENT carries its own data and needs no permission.
    toast.error('Could not read the clipboard', {
      description: `Use ${formatChordText('mod+v')} instead.`,
    })
    return
  }
  if (!text) return
  const decision = evaluatePaste(text, term.modes.bracketedPasteMode)
  if (decision.kind === 'paste') ops.paste(decision.text)
  else ops.confirmPaste(decision)
}
