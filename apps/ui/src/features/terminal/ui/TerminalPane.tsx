import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './terminalPane.css'
import type { TerminalClientFrame, TerminalServerFrame } from '@localixai/api/client'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { openFileInGrid } from '@/features/inspector/model/fileNav'
import { useGridStore, groupOfTab } from '@/features/workspace-grid/model'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { StateNotice } from '@localixai/kit/state-notice'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { PaneStateOverlay } from '@localixai/kit/pane-state-overlay'
import { Button } from '@localixai/kit/button'
import { closeTerminal, getTerminalLiveness, terminalStreamUrl } from '../api'
import { openNewTerminal } from '../model/terminalTabs'
import { closeDeadTerminalTabs } from '../model/deadTerminalTabs'
import { createTerminalLinkProvider, readBufferLines } from './terminalLinkProvider'
import { collectTerminalLinks, type TerminalLinkItem } from '../model/terminalLinks'
import { TerminalPaneOverlays } from './TerminalPaneOverlays'
import { evaluatePaste } from '../model/terminalPaste'
import { createPtySizer } from '../model/terminalPtySizer'
import { createShellIntegration } from '../model/terminalShellIntegration'
import { classifyTerminalKey } from '../model/terminalKeymap'
import { createTerminalInstance } from '../model/terminalInstance'
import { useTerminalPathDrop } from '../model/useTerminalPathDrop'
import { useTerminalFind } from '../model/useTerminalFind'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import type { CommandMenuState } from './TerminalCommandMenu'
import { TerminalFindWidget } from './TerminalFindWidget'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { terminalContextMenu } from './terminalContextMenu'
import {
  DROP_TARGET_HINT,
  DROP_TARGET_OVERLAY_ACTIVE,
  DROP_TARGET_TRANSITION,
} from '@localixai/kit/drop-target'
import {
  createJournalIncident,
  type JournalIncident,
} from '@/shared/lib/notifications/journalIncident'
import { activeEventOrigin } from '@/shared/lib/notifications/context'
import type { NotificationOrigin } from '@/shared/lib/notifications/types'

/**
 * One interactive terminal tab: a real PTY streamed over a WebSocket into xterm.js.
 * The terminal is identified by its BACKEND id (`terminalId`) and this pane only
 * ATTACHES to it — it never creates a PTY (creation happens in the terminalTabs
 * helper before the tab opens). The WS replays scrollback on attach, so a restored
 * or re-revealed tab shows prior output.
 *
 * Several IDE affordances ride on top of the raw stream: file:line links in the
 * output open the source in the editor grid (build/test/lint output → jump to
 * code) and http(s) URLs open in a new tab; ⌘/Ctrl+F opens an in-terminal find
 * widget backed by the xterm search addon; ⌘/Ctrl+K clears the screen+scrollback
 * (kept terminal-side so the global session switcher can't steal it); and, when
 * the shell cooperates (bash/
 * zsh with OSC 133 marks injected at spawn), each command gets an exit-code dot
 * in the gutter (green ok / red fail) that opens a copy-command / copy-output /
 * rerun menu on click — topped by quick fixes derived from the output (set git
 * upstream, git "did you mean", free a stuck port, open a PR link) — and ⌘↑/⌘↓
 * jump between command prompts. When a command's output scrolls its prompt off
 * the top, a sticky one-row header pins that command's text (click = jump back).
 *
 * Lifecycle: the PTY is server-owned and outlives mere session-switches/reloads
 * (so a hidden/warm tab keeps running and a reload reattaches). It is closed ONLY
 * when the user closes the tab AND this pane `owned` it — detected on unmount by
 * the WorkItem having been removed from the grid (a hidden/teardown unmount keeps
 * the item, so it's left alive). Adopted PTYs (agent jobs, dev servers) are never
 * closed from here. A tab whose PTY is already dead on attach (e.g. reaped while
 * the page was gone) self-closes.
 *
 * Recovery: when a connected PTY's socket drops we ask the backend whether the PTY
 * is still listed. A transient WS blip (PTY alive) triggers bounded silent reconnects
 * ("Reconnecting…"); a confirmed dead PTY closes its tab automatically. The same registry check protects
 * a first attach after reload, so a temporarily unreachable daemon cannot discard
 * a live restored tab. An automatic "Restarting… connection lost" state is kept
 * distinct from a relaunch action for an exited process.
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
  // Find widget state + search execution (see model/useTerminalFind.ts).
  const {
    find,
    setFind,
    inputRef: findInputRef,
    open: openFind,
    close: closeFind,
    run: runSearch,
  } = useTerminalFind(searchRef)
  const termRef = useRef<Terminal | null>(null)
  const [connected, setConnected] = useState(false)
  // The PTY's WebSocket dropped after we were connected (shell process ended, dev
  // server restarted, network blip). Without a notice the pane just sits frozen —
  // exactly the confusing "typed a command then it hung forever" report — so we
  // surface an actionable message instead.
  const [dead, setDead] = useState<string | null>(null)
  // A transient WS drop where the backend PTY is still alive → silently reattach
  // with bounded backoff (bumping `connectNonce` re-runs the connect effect against
  // the same PTY, which replays scrollback). Shown as a brief overlay.
  const [reconnecting, setReconnecting] = useState(false)
  const [connectNonce, setConnectNonce] = useState(0)
  const reconnectAttemptsRef = useRef(0)
  const terminalIncidentRef = useRef<JournalIncident | null>(null)
  const activeRef = useLatestRef(active)
  // Read by the link provider, which lives as long as the xterm instance rather than a render.
  const sessionIdRef = useLatestRef(sessionId)
  // Attention (tab activity dot): raised when output arrives while this pane is
  // hidden (off-screen), cleared once it's shown again. The ref mirrors the store
  // flag so the hot per-frame `data` handler skips redundant writes, and a settle
  // timer suppresses the startup/reconnect replay burst (a bell replayed when the
  // terminal starts up or reconnects must not raise attention).
  const attentionRef = useRef(false)
  const activitySettledRef = useRef(false)
  // Link quickpick (⌘/Ctrl+⇧+O): null = closed, else the buffer's detected links.
  const [linkPick, setLinkPick] = useState<TerminalLinkItem[] | null>(null)
  // Pending multi-line paste awaiting user confirmation (null = no prompt).
  const [pastePrompt, setPastePrompt] = useState<{
    text: string
    lineCount: number
    preview: string
  } | null>(null)
  // Set once the terminal exists so the confirm dialog can commit an approved paste.
  const pasteRef = useRef<((text: string) => void) | null>(null)
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

  // Recover a dead terminal: spawn a fresh PTY in the SAME session (the exact rail
  // "New terminal" spawn path) and close this dead tab so the new one takes its
  // place in the terminal group.
  const recover = useCallback(() => {
    void openNewTerminal(sessionId)
    const leaf = groupOfTab(useGridStore.getState().root, paneId)
    if (leaf) useGridStore.getState().closeTab(leaf.id, paneId)
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

  const openLinkPick = useCallback(() => {
    const term = termRef.current
    if (term) setLinkPick(collectTerminalLinks(readBufferLines(term)))
  }, [])

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

  // The xterm key handler is bound ONCE (below), so it would otherwise capture the
  // first render's callbacks forever. Read the latest through refs at call time.
  const openFindRef = useLatestRef(openFind)
  const openLinkPickRef = useLatestRef(openLinkPick)

  // One incident lifecycle spans every reconnect effect generation. Keeping it
  // outside the socket effect lets six bounded attempts become one causal trace
  // instead of six noisy rows; a stable open reports recovery, while unmount or
  // an authoritative dead PTY abandons the transport incident.
  useEffect(() => {
    const routeOrigin = activeEventOrigin()
    const origin: NotificationOrigin = sessionId
      ? {
          kind: 'resource',
          sessionId,
          projectId:
            routeOrigin.kind !== 'application' && routeOrigin.sessionId === sessionId
              ? routeOrigin.projectId
              : null,
          resourceKind: 'terminal',
          resourceId: terminalId,
          label: 'Terminal',
        }
      : { kind: 'application', label: 'Terminal' }
    const incident = createJournalIncident({
      kind: 'terminal.connection',
      origin,
      unavailable: {
        severity: 'warning',
        title: 'Terminal connection unavailable',
        message:
          'The terminal stream could not reconnect. The backend process may still be running.',
      },
      recovered: {
        severity: 'success',
        title: 'Terminal connection restored',
        message: 'The terminal stream is interactive again.',
      },
    })
    terminalIncidentRef.current = incident
    return () => {
      incident.abandon()
      if (terminalIncidentRef.current === incident) terminalIncidentRef.current = null
    }
  }, [sessionId, terminalId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let dropHandled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stableTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    // A body hidden by the grid (warm/background tab) is `display:none`, so its
    // host has no offsetParent — the reliable "am I currently off-screen?" signal
    // without threading a new prop.
    const isHidden = () => host.offsetParent === null
    const raiseAttention = () => {
      if (attentionRef.current || !activitySettledRef.current || !isHidden()) return
      attentionRef.current = true
      useGridStore.getState().setItemAttention(paneId, true)
    }
    const clearAttention = () => {
      if (!attentionRef.current) return
      attentionRef.current = false
      useGridStore.getState().setItemAttention(paneId, false)
    }

    // xterm instance + addons, with the font/density/theme integration app-side values
    // need (xterm measures concrete px, so no var()/rem). See createTerminalInstance.
    const instance = createTerminalInstance(
      host,
      () => disposed,
      () => {
        // The sizer is created further down this same effect, so by the time
        // `fonts.ready` resolves this ref is set; `false` only covers a font that
        // was already loaded and resolved synchronously ahead of it.
        const refit = fitRef.current
        if (!refit) return false
        refit()
        return true
      },
    )
    const { term, fit, search } = instance
    searchRef.current = search
    termRef.current = term

    // File:line + URL links in the output. File links reveal the source in the
    // editor grid of THIS terminal's chat (relative paths resolve against its cwd,
    // like the file tree) — never the chat on screen; URLs open in a new tab.
    term.registerLinkProvider(
      createTerminalLinkProvider(term, {
        openFile: (path, line) =>
          openFileInGrid({
            sessionId: sessionIdRef.current,
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
    // the disposed flag, then drives it from onData/resize/cleanup below.
    const shell = createShellIntegration({
      term,
      isDisposed: () => disposed,
      onSticky: setSticky,
      onCommandMenu: setCmdMenu,
    })

    // Keep the find widget's result counter in sync with the addon.
    search.onDidChangeResults(({ resultCount, resultIndex }) => {
      if (!disposed) setFind((f) => ({ ...f, count: resultCount, index: resultIndex }))
    })

    // Copy-on-select: mirror the classic terminal convention — a text selection is
    // almost always meant for the clipboard. Best-effort; the clipboard API can
    // reject when the document isn't focused, which is harmless here.
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) void platformCapabilities().clipboard.writeText(selection)
    })

    // Commit an approved paste through xterm so bracketed-paste framing is honored.
    pasteRef.current = (text: string) => {
      term.paste(text)
      term.focus()
    }

    // Guard multi-line pastes: intercept the paste before xterm's own textarea
    // handler (capture phase on the host, which is an ancestor of xterm's helper
    // textarea) so we can strip a trailing newline or confirm a true multi-line
    // paste instead of blindly feeding newlines (command boundaries) to the shell.
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
      setPastePrompt({
        text: decision.text,
        lineCount: decision.lineCount,
        preview: decision.preview,
      })
    }
    host.addEventListener('paste', onPaste, true)

    // Terminal-scoped hotkeys. Only the chords the terminal itself CLAIMS are
    // swallowed here (find, link palette, clear, prompt-nav);
    // everything else — typing keys AND workspace-level chords (⌘⇧P
    // palette, ⌘B sidebar, ⌘J maximize, F6 focus ring, ⌘⌥P/⌘⌥T switchers) —
    // passes through so those still work from a focused terminal.
    // Routing is the pure, tested `classifyTerminalKey`; this is just the plumbing.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const action = classifyTerminalKey(e)
      switch (action) {
        case 'passthrough':
          return true
        case 'find':
          openFindRef.current()
          break
        case 'open-links':
          openLinkPickRef.current()
          break
        case 'clear':
          // ⌘/Ctrl+K — clear the screen + scrollback, keeping the current prompt
          // line (the usual terminal "Clear"). `clear()` drops the buffer and
          // promotes the prompt row to the new first line, so the shell keeps its
          // live input intact.
          term.clear()
          break
        case 'jump-prev':
          shell.jumpCommand(-1)
          break
        case 'jump-next':
          shell.jumpCommand(1)
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

    const send = (frame: TerminalClientFrame) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
    }

    // Fit + PTY sizing glue lives in the sizer (gating/clamping in terminalResize.ts).
    const sizer = createPtySizer({ term, host, fit, send })
    fitRef.current = sizer.fit
    sizer.fit()

    // Post-connect drop: ask the backend whether this PTY is still alive. Alive →
    // a transient blip, so silently reattach with bounded exponential backoff.
    // An unavailable liveness endpoint is NOT evidence that the PTY died: retry
    // it like a transport outage. Only an authoritative "not listed" is dead.
    const handleDrop = () => {
      if (disposed || dropHandled) return
      dropHandled = true
      terminalIncidentRef.current?.begin()
      setConnected(false)
      if (reconnectAttemptsRef.current >= 6) {
        // Trace only: `setDead` below publishes the problem report for this same give-up, and that
        // is the row that carries "New terminal". Two rows for one event is a journal, not a centre.
        terminalIncidentRef.current?.fail({
          silent: true,
          sourceVisible: activeRef.current,
          attributes: { attempts: reconnectAttemptsRef.current },
        })
        setDead('The terminal stream could not reconnect.')
        setReconnecting(false)
        return
      }
      setReconnecting(true)
      void getTerminalLiveness(terminalId).then((liveness) => {
        if (disposed) return
        if (liveness === 'dead') {
          // Not a transport incident — the process is gone.
          terminalIncidentRef.current?.abandon()
          setReconnecting(false)
          closeDeadTerminalTabs(terminalId)
          return
        }
        const attempt = reconnectAttemptsRef.current++
        const delay = Math.min(250 * 2 ** attempt, 4_000)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          if (!disposed) setConnectNonce((n) => n + 1)
        }, delay)
      })
    }

    term.onData((data) => {
      // First keystroke at a prompt whose input column is still pending (old-rc
      // B at column 0): capture the real input start before the key echoes.
      shell.noteKeystroke()
      send({ t: 'input', data })
    })
    // Writer the terminal bus uses to paste an agent-suggested command in.
    writeRef.current = (data) => {
      send({ t: 'input', data })
      term.focus()
    }

    const resizeObserver = new ResizeObserver(() => {
      // safeFit gates on real host dimensions AND schedules the (deduped,
      // debounced) PTY resize itself — a hidden/0px fire does nothing, and the
      // re-show fire (0×0 → sized) re-fits + re-syncs the PTY so a full-screen
      // app gets exactly one correct SIGWINCH to repaint by.
      sizer.fit()
      shell.refresh()
      // A hidden→shown transition resizes the host from 0×0 to real dimensions;
      // seeing the tab clears its unseen-activity mark.
      if (!isHidden()) clearAttention()
    })
    resizeObserver.observe(host)

    ws = new WebSocket(terminalStreamUrl(terminalId))
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let frame: TerminalServerFrame
      try {
        frame = JSON.parse(ev.data) as TerminalServerFrame
      } catch {
        return
      }
      if (frame.t === 'data') {
        term.write(frame.data)
        raiseAttention()
      } else if (frame.t === 'exit') {
        term.write(`\r\n\x1b[2m[process exited: ${frame.code}]\x1b[0m\r\n`)
      }
    }
    ws.onopen = () => {
      if (disposed) return
      setConnected(true)
      // A (re)connect clears any pending disconnect/reconnect notice.
      setReconnecting(false)
      setDead(null)
      dropHandled = false
      // A fresh attach must always tell the PTY our dimensions (it may have been
      // created 80×24, or drifted while detached) → reset the dedupe and send now.
      sizer.reset()
      sizer.sync(true)
      // Ignore the historical scrollback replay that lands right after connect —
      // only genuinely live output should raise the tab activity dot.
      activitySettledRef.current = false
      setTimeout(() => {
        if (!disposed) activitySettledRef.current = true
      }, 500)
      // A genuinely stable attachment earns a fresh retry budget. Resetting on
      // every open would allow a tight open/close flap to retry forever.
      stableTimer = setTimeout(() => {
        if (!disposed) {
          reconnectAttemptsRef.current = 0
          terminalIncidentRef.current?.recover({ sourceVisible: activeRef.current })
        }
      }, 10_000)
    }
    ws.onclose = () => {
      if (disposed) return // normal teardown (unmount closed the socket) → no notice
      // This also covers the FIRST attach after a reload: an unavailable stream is
      // not evidence the server-owned PTY died. Registry liveness below decides
      // retry vs recovery for both initial and post-connect drops.
      handleDrop()
    }
    ws.onerror = () => {
      if (!disposed) handleDrop()
    }

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (stableTimer) clearTimeout(stableTimer)
      fitRef.current = null
      writeRef.current = null
      searchRef.current = null
      termRef.current = null
      pasteRef.current = null
      host.removeEventListener('paste', onPaste, true)
      sizer.dispose()
      shell.dispose()
      instance.dispose()
      resizeObserver.disconnect()
      try {
        ws?.close()
      } catch {
        /* already closed */
      }
      // Kill the PTY ONLY when the user actually closed this tab (the WorkItem is
      // gone from the grid) and this pane owned it. A hidden/warm/reload unmount
      // keeps the item, so the server-side PTY survives to be reattached.
      if (owned && !useGridStore.getState().items[paneId]) void closeTerminal(terminalId)
      term.dispose()
    }
    // `connectNonce` re-runs this effect to reattach after a transient WS drop. The three
    // `*Ref`s are stable ref objects (their identity never changes) — listed only so the
    // exhaustive-deps rule can see them; they never re-trigger the effect.
    // `setFind` is a stable setState from useTerminalFind — listed so the rule can see
    // it, not because the effect should re-run for it.
  }, [
    paneId,
    terminalId,
    owned,
    connectNonce,
    activeRef,
    sessionIdRef,
    openFindRef,
    openLinkPickRef,
    setFind,
  ])

  // Becoming the active (visible) tab after being display:none means the host went
  // 0×0 → sized; re-fit so the PTY matches the new viewport.
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => fitRef.current?.())
    // Focusing the tab means the user is looking at it → any unseen-activity mark
    // is now seen. (The resize handler covers the shown-but-unfocused case.)
    if (attentionRef.current) {
      attentionRef.current = false
      useGridStore.getState().setItemAttention(paneId, false)
    }
  }, [active, paneId])

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
    <div className="relative h-full min-h-0 w-full" {...pathDrop.handlers}>
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
      {sticky && (
        <button
          type="button"
          onClick={jumpToSticky}
          title={`Running command — click to jump to its prompt\n${sticky.text}`}
          aria-label={`Sticky command: ${sticky.text}. Click to jump to its prompt.`}
          // No `backdrop-blur-sm`: the 95% fill already hides the scrollback behind
          // this pill, while the filter would re-sample the backdrop on every frame
          // of a fast terminal scroll.
          className="focus-ring lx-occluder absolute inset-x-0 top-0 z-(--z-raised) flex items-center gap-1.5 border-b border-border-soft px-2 py-0.5 text-left font-mono text-xs text-text-soft hover:text-foreground"
        >
          <span className="shrink-0 select-none text-2xs text-text-soft">↳</span>
          <span className="truncate">{sticky.text}</span>
        </button>
      )}
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
      {reconnecting && !dead && (
        <PaneStateOverlay className="pointer-events-none z-(--z-controls)">
          <ActivitySignal
            label="Reconnecting"
            className="text-xs text-text-soft"
            labelClassName="min-w-0"
          />
        </PaneStateOverlay>
      )}
      {dead && (
        <PaneStateOverlay material="subtle" className="pointer-events-none z-(--z-controls)">
          <StateNotice
            className="pointer-events-auto max-w-sm flex-none"
            title="Terminal disconnected"
            body={problem && <ProblemLine {...problem} className="items-center" />}
            actionsLabel="Terminal recovery actions"
            actions={
              <Button type="button" variant="ghost" size="sm" onClick={recover}>
                New terminal
              </Button>
            }
          />
        </PaneStateOverlay>
      )}
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
