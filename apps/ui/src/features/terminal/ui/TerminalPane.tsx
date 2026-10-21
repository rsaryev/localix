import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './terminalPane.css'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useGridStore, closeGridTab } from '@/entities/workspace-grid/model'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { useProblemReport } from '@/shared/ui/problem-report'
import { openNewTerminal } from '../model/terminalTabs'
import type { TerminalExit } from '@/shared/lib/terminalBus'
import { readBufferLines } from './terminalLinkProvider'
import { collectTerminalLinks, type TerminalLinkItem } from '../model/terminalLinks'
import { TerminalPaneOverlays } from './TerminalPaneOverlays'
import { useTerminalPathDrop } from '../model/useTerminalPathDrop'
import { useTerminalFind } from '../model/useTerminalFind'
import type { CommandMenuState } from './TerminalCommandMenu'
import { TerminalFindWidget } from './TerminalFindWidget'
import { TerminalConnectionState, TerminalStickyCommand } from './TerminalPaneStatus'
import type { PastePrompt } from './terminalInput'
import { useTerminalConnection } from './useTerminalConnection'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { terminalContextMenu } from './terminalContextMenu'
import {
  DROP_TARGET_HINT,
  DROP_TARGET_OVERLAY_ACTIVE,
  DROP_TARGET_TRANSITION,
} from '@localixai/kit/drop-target'

/** A tab attaches to a server-owned PTY; hidden tabs and reloads preserve it.
 * Closing an owned tab closes its PTY. Dead tabs retain output; live PTYs reconnect with backoff.
 * Links, search, shell integration, paste confirmation and command menus share the xterm instance.
 */
export function TerminalPane({
  paneId,
  terminalId,
  sessionId,
  owned,
  active,
}: {
  paneId: string
  terminalId: string
  /** The chat this terminal belongs to (its tab's scope). */
  sessionId: string
  owned: boolean
  active: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<(() => void) | null>(null)
  const writeRef = useRef<((data: string) => void) | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  // Set once the terminal exists so the confirm dialog can commit an approved paste.
  const pasteRef = useRef<((text: string) => void) | null>(null)
  // Find widget state + search execution (see model/useTerminalFind.ts).
  const {
    find,
    setFind,
    inputRef: findInputRef,
    open: openFind,
    close: closeFind,
    run: runSearch,
  } = useTerminalFind(searchRef)
  const terminalExit = useGridStore(
    (state) => state.items[paneId]?.payload?.terminalExit as TerminalExit | undefined,
  )
  // Link quickpick (⌘/Ctrl+⇧+O): null = closed, else the buffer's detected links.
  const [linkPick, setLinkPick] = useState<TerminalLinkItem[] | null>(null)
  // Pending multi-line paste awaiting user confirmation (null = no prompt).
  const [pastePrompt, setPastePrompt] = useState<PastePrompt | null>(null)
  // Exit-code-dot action menu (copy command / output, rerun); null = closed.
  const [cmdMenu, setCmdMenu] = useState<CommandMenuState | null>(null)
  // Sticky-scroll header: the running/scrolled command whose prompt is off the
  // top of the viewport (null = nothing to pin). `line` is its prompt row so a
  // click can jump back to it.
  const [sticky, setSticky] = useState<{ text: string; line: number } | null>(null)
  // Stable jump handler for the sticky header click (term ref read at call time).
  const jumpToSticky = useCallback(() => {
    const term = termRef.current
    if (term && sticky) term.scrollToLine(sticky.line)
  }, [sticky])

  const openLinkPick = useCallback(() => {
    const term = termRef.current
    if (term) setLinkPick(collectTerminalLinks(readBufferLines(term)))
  }, [])

  const { connected, dead, reconnecting } = useTerminalConnection({
    refs: {
      host: hostRef,
      fit: fitRef,
      write: writeRef,
      search: searchRef,
      term: termRef,
      paste: pasteRef,
    },
    paneId,
    terminalId,
    sessionId,
    owned,
    active,
    terminalExit,
    openFind,
    openLinkPick,
    setFind,
    setSticky,
    setCmdMenu,
    setPastePrompt,
  })

  const recover = useCallback(() => {
    void openNewTerminal(sessionId).then((opened) => {
      if (opened) closeGridTab(paneId)
    })
  }, [sessionId, paneId])

  // A pane that will not come back. The transport incident above traces the reconnect attempts;
  // this is the standing fact that the terminal is over, and the only one carrying the recovery.
  const problem = useProblemReport(
    dead
      ? // `stale`, not `blocked`: the recovery notice sits on a SUBTLE overlay, so the scrollback
        // this terminal produced is still on screen and still readable. Only the session is over.
        { subject: { label: 'Terminal' }, problems: [{ message: dead }], consequence: 'stale' }
      : null,
    {
      scope: 'terminal',
      sourceVisible: active,
      actions: [{ id: 'new-terminal', label: 'New terminal', run: recover }],
    },
  )

  // Drop a file onto the pane to paste its shell-quoted path at the prompt. `pasteRef`
  // only exists once xterm is built, so it is read lazily. See useTerminalPathDrop.
  const pathDrop = useTerminalPathDrop(useCallback(() => pasteRef.current, []))

  // The terminal's right-click menu. Built on open, not memoized — see `terminalContextMenu`.
  const buildTerminalMenu = useCallback(
    () =>
      terminalContextMenu({
        term: termRef.current,
        paste: (text) => pasteRef.current?.(text),
        confirmPaste: (decision) =>
          setPastePrompt({
            text: decision.text,
            lineCount: decision.lineCount,
            preview: decision.preview,
          }),
        openFind,
        openLinks: openLinkPick,
      }),
    [openFind, openLinkPick],
  )

  // The active, connected pane receives `terminal.run(...)` for ITS chat from a transcript code
  // block (flushing any command queued for that chat before connect).
  useEffect(() => {
    if (active && connected && writeRef.current) {
      return terminalBus.setActiveSender(sessionId, (data) => writeRef.current?.(data))
    }
  }, [active, connected, sessionId])

  // No ground coat: the hosting pane already paints one, and under the macOS glass theme the
  // ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab. This is
  // the ground `terminalTheme.ts` defers to when it hands xterm a fully transparent background.
  return (
    <div
      data-slot="terminal-pane"
      data-terminal-exited={terminalExit ? 'true' : undefined}
      className="relative flex h-full min-h-0 w-full flex-col"
      {...pathDrop.handlers}
    >
      <div className="relative min-h-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {/* The breathing room is the WRAPPER's; the xterm host itself must stay padding-free.
              The fit addon measures the host with `getComputedStyle(host).height/width`, which
              Chrome resolves to the BORDER box — padding included. A padded host therefore
              advertised ~12px more height and ~16px more width than it had, fit handed back a row
              (and up to two columns) too many, and the host's own top padding pushed the grid down
              on top of that: the last line was permanently sliced by the pane's overflow-hidden and
              the right-most column ran under the edge. Measured across 200–700px at dpr 1 and 2,
              the padded host overflowed at EVERY height; padding-free, at none. */}
            <div className="absolute inset-0 px-2 py-1.5 text-foreground">
              <div ref={hostRef} className="h-full w-full" />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            // Radix returns focus to the TRIGGER, which is the xterm host rather than the helper
            // textarea xterm actually types into — so without this the terminal looked focused and
            // swallowed every keystroke after the menu closed.
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              termRef.current?.focus()
            }}
          >
            <MenuEntries entries={buildTerminalMenu()} family="context" />
          </ContextMenuContent>
        </ContextMenu>
        {pathDrop.active && (
          <div
            className={`pointer-events-none absolute inset-0 z-(--z-sticky) flex items-center justify-center rounded-[inherit] p-4 ${DROP_TARGET_TRANSITION} ${DROP_TARGET_OVERLAY_ACTIVE}`}
          >
            <div className={DROP_TARGET_HINT}>Drop to paste path</div>
          </div>
        )}
        {sticky && <TerminalStickyCommand text={sticky.text} onJump={jumpToSticky} />}
        {find.open && (
          <TerminalFindWidget
            find={find}
            inputRef={findInputRef}
            setFind={setFind}
            runSearch={runSearch}
            onClose={closeFind}
          />
        )}
        <TerminalPaneOverlays
          sessionId={sessionId}
          linkPick={linkPick}
          setLinkPick={setLinkPick}
          cmdMenu={cmdMenu}
          setCmdMenu={setCmdMenu}
          focusTerm={() => termRef.current?.focus()}
          write={(data) => writeRef.current?.(data)}
        />
        {!terminalExit && (
          <TerminalConnectionState
            reconnecting={reconnecting}
            dead={dead}
            problem={problem}
            onRecover={recover}
          />
        )}
      </div>
      <ConfirmDialog
        open={pastePrompt !== null}
        variant="default"
        title={`Paste ${pastePrompt?.lineCount ?? 0} lines into the terminal?`}
        description={
          pastePrompt
            ? `Each newline runs as a separate command. Preview: ${pastePrompt.preview.replace(/\n/g, ' ⏎ ')}`
            : undefined
        }
        confirmLabel="Paste"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pastePrompt) pasteRef.current?.(pastePrompt.text)
          setPastePrompt(null)
        }}
        onClose={() => setPastePrompt(null)}
      />
    </div>
  )
}
