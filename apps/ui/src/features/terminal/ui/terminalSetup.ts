import type { RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import { openFileInGrid } from '@/features/inspector/model/fileNav'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { createShellIntegration } from '../model/terminalShellIntegration'
import type { TerminalFind } from '../model/useTerminalFind'
import type { TerminalExit } from '../model/deadTerminalTabs'
import { createTerminalLinkProvider } from './terminalLinkProvider'
import { attachTerminalHotkeys, bindTerminalPasteGuard, type PastePrompt } from './terminalInput'

export type ShellIntegrationOptions = Parameters<typeof createShellIntegration>[0]

/** Refs the pane shares with the connection (all filled while the xterm instance lives). */
export interface TerminalPaneRefs {
  host: RefObject<HTMLDivElement | null>
  fit: RefObject<(() => void) | null>
  write: RefObject<((data: string) => void) | null>
  search: RefObject<SearchAddon | null>
  term: RefObject<Terminal | null>
  paste: RefObject<((text: string) => void) | null>
}

export interface TerminalConnectionInput {
  refs: TerminalPaneRefs
  paneId: string
  terminalId: string
  sessionId: string
  owned: boolean
  active: boolean
  terminalExit: TerminalExit | undefined
  openFind: () => void
  openLinkPick: () => void
  setFind: TerminalFind['setFind']
  setSticky: ShellIntegrationOptions['onSticky']
  setCmdMenu: ShellIntegrationOptions['onCommandMenu']
  setPastePrompt: (prompt: PastePrompt | null) => void
}

export interface TerminalInteractionOptions {
  isDisposed: () => boolean
  sessionId: () => string
  setSticky: ShellIntegrationOptions['onSticky']
  setCmdMenu: ShellIntegrationOptions['onCommandMenu']
  setFind: TerminalFind['setFind']
  setPastePrompt: (prompt: PastePrompt | null) => void
  openFind: () => void
  openLinks: () => void
}

/**
 * Wires links, shell integration, find counters, copy-on-select, the paste guard and the
 * terminal hotkeys into a fresh xterm. Returns the shell integration, the committed-paste
 * writer and the disposer for the DOM listener it adds.
 */
export function setupTerminalInteractions(
  term: Terminal,
  host: HTMLElement,
  search: SearchAddon,
  options: TerminalInteractionOptions,
) {
  // File:line + URL links in the output. File links reveal the source in the
  // editor grid of THIS terminal's chat (relative paths resolve against its cwd,
  // like the file tree) — never the chat on screen; URLs open in a new tab.
  term.registerLinkProvider(
    createTerminalLinkProvider(term, {
      openFile: (path, line) =>
        openFileInGrid({
          sessionId: options.sessionId(),
          path,
          ...(line !== undefined ? { line } : {}),
        }),
      openUrl: (url) => platformCapabilities().external.open(url),
    }),
  )

  // Shell integration (OSC 133) + sticky-scroll: per-command exit-code gutter
  // dots + click menu, ⌘↑/⌘↓ prompt-jump, and the pinned sticky header. The
  // byte-critical marker/decoration logic lives verbatim in
  // terminalShellIntegration.ts; the pane just wires in its React setters and
  // the disposed flag, then drives it from onData/resize/cleanup.
  const shell = createShellIntegration({
    term,
    isDisposed: options.isDisposed,
    onSticky: options.setSticky,
    onCommandMenu: options.setCmdMenu,
  })

  // Keep the find widget's result counter in sync with the addon.
  search.onDidChangeResults(({ resultCount, resultIndex }) => {
    if (!options.isDisposed()) {
      options.setFind((f) => ({ ...f, count: resultCount, index: resultIndex }))
    }
  })

  // Copy-on-select: mirror the classic terminal convention — a text selection is
  // almost always meant for the clipboard. Best-effort; the clipboard API can
  // reject when the document isn't focused, which is harmless here.
  term.onSelectionChange(() => {
    const selection = term.getSelection()
    if (selection) void platformCapabilities().clipboard.writeText(selection)
  })

  // Commit an approved paste through xterm so bracketed-paste framing is honored.
  const paste = (text: string) => {
    term.paste(text)
    term.focus()
  }

  const disposePasteGuard = bindTerminalPasteGuard(host, term, options.setPastePrompt)

  attachTerminalHotkeys(term, {
    find: options.openFind,
    openLinks: options.openLinks,
    jumpCommand: shell.jumpCommand,
  })

  return { shell, paste, dispose: disposePasteGuard }
}
