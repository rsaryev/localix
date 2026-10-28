import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalClientFrame } from '@localixai/api/client'
import { useGridStore } from '@/entities/workspace-grid/model'
import { getTerminalLiveness } from '../api'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { terminalTransferReadyKey, workItemTransferReady } from '@/shared/lib/workItemTransferReady'
import { finishTerminalTabs } from '../model/deadTerminalTabs'
import { terminalOutput } from '../model/terminalOutput'
import { createPtySizer } from '../model/terminalPtySizer'
import { createTerminalInstance } from '../model/terminalInstance'
import { useTerminalConnectionIncident } from '../model/useTerminalConnectionIncident'
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay } from '../model/terminalReconnect'
import { createTabAttention } from '../model/terminalAttention'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { setupTerminalInteractions, type TerminalConnectionInput } from './terminalSetup'
import { observeHostResize, useTerminalPaneSync } from './useTerminalPaneSync'
import { closeOwnedPtyIfGone, openTerminalStream, type TerminalStreamLink } from './terminalStream'

/**
 * The xterm instance and its server-owned PTY stream: builds the terminal into the host, attaches
 * the WebSocket, reconnects with bounded backoff, tracks hidden-tab attention and closes an owned
 * PTY when its tab is really gone.
 */
export function useTerminalConnection({
  refs,
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
}: TerminalConnectionInput) {
  const {
    host: hostRef,
    fit: fitRef,
    write: writeRef,
    search: searchRef,
    term: termRef,
    paste: pasteRef,
  } = refs
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
  const terminalIncidentRef = useTerminalConnectionIncident(sessionId, terminalId)
  const activeRef = useLatestRef(active)
  // Read by the link provider, which lives as long as the xterm instance rather than a render.
  const sessionIdRef = useLatestRef(sessionId)
  // Tab activity dot state (see createTabAttention).
  const attentionRef = useRef(false)
  const activitySettledRef = useRef(false)
  // The xterm key handler is bound ONCE (below), so it would otherwise capture the
  // first render's callbacks forever. Read the latest through refs at call time.
  const openFindRef = useLatestRef(openFind)
  const openLinkPickRef = useLatestRef(openLinkPick)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    workItemTransferState.attached(paneId)

    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stableTimer: ReturnType<typeof setTimeout> | null = null
    const link: TerminalStreamLink = { ws: null, dropHandled: false }

    const attention = createTabAttention(paneId, host, {
      attention: attentionRef,
      settled: activitySettledRef,
    })

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
    term.options.disableStdin = Boolean(
      useGridStore.getState().items[paneId]?.payload?.terminalExit,
    )

    const interactions = setupTerminalInteractions(term, host, search, {
      isDisposed: () => disposed,
      sessionId: () => sessionIdRef.current,
      setSticky,
      setCmdMenu,
      setFind,
      setPastePrompt,
      openFind: () => openFindRef.current(),
      openLinks: () => openLinkPickRef.current(),
    })
    const { shell } = interactions
    pasteRef.current = interactions.paste

    const send = (frame: TerminalClientFrame) => {
      if (useGridStore.getState().items[paneId]?.payload?.terminalExit) return
      const ws = link.ws
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
      if (disposed || link.dropHandled) return
      link.dropHandled = true
      terminalIncidentRef.current?.begin()
      setConnected(false)
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
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
          term.options.disableStdin = true
          finishTerminalTabs(terminalId, { exitCode: null })
          return
        }
        const attempt = reconnectAttemptsRef.current++
        const delay = reconnectDelay(attempt)
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

    const resizeObserver = observeHostResize(host, sizer, shell, attention)

    const retained = useGridStore.getState().items[paneId]?.payload?.terminalExit
      ? terminalOutput(terminalId)
      : undefined
    if (retained !== undefined) {
      term.write(retained)
      workItemTransferReady.success(terminalTransferReadyKey(terminalId))
    } else {
      openTerminalStream(terminalId, term, link, {
        isDisposed: () => disposed,
        onOutput: attention.raise,
        onEnded: () => {
          setConnected(false)
          setReconnecting(false)
          terminalIncidentRef.current?.abandon()
        },
        onOpen: () => {
          setConnected(true)
          // A (re)connect clears any pending disconnect/reconnect notice.
          setReconnecting(false)
          setDead(null)
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
        },
        onDrop: handleDrop,
      })
    }

    return () => {
      disposed = true
      // A torn-down attachment is not connected; the next one says so itself when it opens (a
      // retained, already-exited terminal never does, and stays "not connected").
      setConnected(false)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (stableTimer) clearTimeout(stableTimer)
      fitRef.current = null
      writeRef.current = null
      searchRef.current = null
      termRef.current = null
      pasteRef.current = null
      interactions.dispose()
      sizer.dispose()
      shell.dispose()
      instance.dispose()
      resizeObserver.disconnect()
      try {
        link.ws?.close()
      } catch {
        /* already closed */
      }
      closeOwnedPtyIfGone(paneId, terminalId, owned)
      term.dispose()
    }
    // `connectNonce` re-runs this effect to reattach after a transient WS drop. The three
    // `*Ref`s are stable ref objects (their identity never changes) — listed only so the
    // exhaustive-deps rule can see them; they never re-trigger the effect.
    // `setFind` is a stable setState from useTerminalFind, and the pane's refs and setters are
    // stable too — listed so the rule can see them, not because the effect should re-run for them.
  }, [
    paneId,
    terminalId,
    owned,
    connectNonce,
    activeRef,
    terminalIncidentRef,
    sessionIdRef,
    openFindRef,
    openLinkPickRef,
    setFind,
    hostRef,
    fitRef,
    writeRef,
    searchRef,
    termRef,
    pasteRef,
    setSticky,
    setCmdMenu,
    setPastePrompt,
  ])

  const abandonOnExit = useCallback(() => {
    setReconnecting(false)
    terminalIncidentRef.current?.abandon()
  }, [terminalIncidentRef])
  useTerminalPaneSync({
    paneId,
    active,
    terminalExit,
    term: termRef,
    fit: fitRef,
    attention: attentionRef,
    onExit: abandonOnExit,
  })

  return { connected, dead, reconnecting }
}
