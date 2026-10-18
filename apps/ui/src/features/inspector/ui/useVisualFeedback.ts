import { useCallback, useEffect, useRef, useState } from 'react'

import { getThemeVars, themeVarsBus } from '@/features/chat/model/themeVarsBus'
import type {
  VfCapture,
  VfCommand,
  VfCommandResult,
  VfHostMessage,
  VfImage,
  VfMark,
  VfMode,
  VfProbeMessage,
  VfRect,
} from '@localixai/visual-feedback/protocol'
import { VF_BRIDGE_KEY, VF_PROTOCOL_VERSION } from '@localixai/visual-feedback/protocol'
import { clearProbeProblem, reportProbeProblem } from './visualFeedbackProblem'

/** Reply from the probe after running one agent command (or a host-side short-circuit). */
export interface VfCommandReply {
  ok: boolean
  result?: VfCommandResult
  error?: string
  errorCode?: 'not_found' | 'intercepted' | 'bad_request' | 'failed'
  /** Set by the host when no probe is connected — nothing executed. */
  notEngaged?: boolean
}

export interface VisualFeedbackBridge {
  /** Probe handshaked at least once (per current iframe load). */
  connected: boolean
  mode: VfMode
  /** A just-picked element awaiting a note (drives the host composer). */
  pending: { capture: VfCapture; rect: VfRect } | null
  setMode: (mode: VfMode) => void
  clearPending: () => void
  /** Quietly highlight every element that already carries a comment (re-sent on reconnect). */
  setMarks: (marks: VfMark[]) => void
  /** A commented element the person clicked in the page: the comment to open, and where. */
  openedMark: { id: string; rect: VfRect } | null
  clearOpenedMark: () => void
  /** Call on iframe `load`: the old probe is gone until the new page handshakes. */
  notifyReload: () => void
  /** Scroll a saved comment's element into view + highlight it (clicked in the list). */
  reveal: (selector: string) => void
  /** Agent-driven control: run one command against the probe, resolving with its result. */
  runCommand: (commandId: string, command: VfCommand) => Promise<VfCommandReply>
  /** Resolve true once the probe is connected (immediately if already), false on timeout. */
  whenConnected: (timeoutMs?: number) => Promise<boolean>
  /** Rasterize one element (by selector) in-page → JPEG, no screen-share permission. */
  captureElement: (selector: string) => Promise<VfImage | null>
}

/**
 * Host side of the visual-feedback bridge. The probe (injected into the preview)
 * self-generates a channelId and announces it via `ready`; we trust the message by
 * `e.source === iframe.contentWindow` (the static preview is a dynamic ephemeral
 * origin, so origin can't be hardcoded — mirrors the plugin-panel bridge). On each
 * (re)connect we re-send the current mode and theme vars,
 * so a preview reload re-syncs automatically.
 */
export function useVisualFeedback(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
): VisualFeedbackBridge {
  const [connected, setConnected] = useState(false)
  const [mode, setModeState] = useState<VfMode>('off')
  const [pending, setPending] = useState<{ capture: VfCapture; rect: VfRect } | null>(null)
  const [openedMark, setOpenedMark] = useState<{ id: string; rect: VfRect } | null>(null)
  // The pick being written about, readable by the mount-once handler: a reloaded page re-finds it.
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  })

  // Mirror state into refs so the mount-once message handler reads current values
  // without re-subscribing.
  const channelRef = useRef<string | null>(null)
  const modeRef = useRef<VfMode>('off')
  // Kept so a reloaded page gets its comment highlights back on the next handshake.
  const marksRef = useRef<VfMark[]>([])
  // In-flight agent commands awaiting a `command-result`, keyed by commandId.
  const pendingCommandsRef = useRef<Map<string, (reply: VfCommandReply) => void>>(new Map())
  // Callers blocked in whenConnected(), resolved on the next `ready` handshake.
  const connectionWaitersRef = useRef<Array<(ok: boolean) => void>>([])
  // Monotonic id source for host-initiated commands (e.g. the comment-camera capture).
  const cmdSeqRef = useRef(0)
  const probeProblemRef = useRef(false)

  const post = useCallback(
    (msg: VfHostMessage) => {
      const ch = channelRef.current
      const win = iframeRef.current?.contentWindow
      if (!ch || !win) return
      win.postMessage({ ...msg, [VF_BRIDGE_KEY]: ch }, '*')
    },
    [iframeRef],
  )

  // Incoming probe → host events.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const win = iframeRef.current?.contentWindow
      if (!win || e.source !== win) return
      const data = e.data as (VfProbeMessage & { [VF_BRIDGE_KEY]?: string }) | null
      if (!data || typeof data[VF_BRIDGE_KEY] !== 'string') return
      if (data.type === 'ready') {
        if (data.version !== VF_PROTOCOL_VERSION || data.channelId !== data[VF_BRIDGE_KEY]) return
      } else if (data[VF_BRIDGE_KEY] !== channelRef.current) return
      switch (data.type) {
        case 'ready': {
          // A new channel is a new page: the old one can no longer answer what was sent to it
          // (an `evaluate` of `location.reload()`, a form submit), so say so now instead of
          // letting each command wait out its timeout.
          if (channelRef.current && channelRef.current !== data.channelId) {
            for (const resolve of pendingCommandsRef.current.values()) {
              resolve({
                ok: false,
                error: 'The page reloaded before replying.',
                errorCode: 'failed',
              })
            }
            pendingCommandsRef.current.clear()
          }
          channelRef.current = data.channelId
          setConnected(true)
          // Release anyone awaiting connection (e.g. an agent command that just
          // engaged the proxy and is waiting for the probe to handshake).
          for (const w of connectionWaitersRef.current) w(true)
          connectionWaitersRef.current = []
          // A fresh `ready` (probe sends it once per page load) means a reloaded page. A comment
          // being written survives it: dev servers reload on every save, and dropping the card
          // threw away what the person was typing. The new page is asked to find the element
          // again, so the card follows it; where it is gone, the card stays where it was.
          // The page that reported a probe problem is gone with the reload.
          if (probeProblemRef.current) {
            probeProblemRef.current = false
            clearProbeProblem()
          }
          // Re-sync everything for this (possibly reloaded) probe.
          post({ type: 'theme', vars: toVfVars(getThemeVars()) })
          post({ type: 'set-mode', mode: modeRef.current })
          post({ type: 'set-marks', marks: marksRef.current })
          const writing = pendingRef.current?.capture.selector
          if (writing) post({ type: 'reveal', selector: writing })
          break
        }
        case 'selected':
          setOpenedMark(null)
          setPending({ capture: data.capture, rect: data.capture.rect })
          break
        case 'active-rect':
          if (!data.rect) break
          setPending((p) => (p ? { ...p, rect: data.rect! } : p))
          setOpenedMark((m) => (m ? { ...m, rect: data.rect! } : m))
          break
        case 'open-mark':
          setPending(null)
          setOpenedMark({ id: data.id, rect: data.rect })
          break
        case 'escape':
          // Esc from inside the preview → leave comment mode (clears any pending pick).
          modeRef.current = 'off'
          setModeState('off')
          setPending(null)
          setOpenedMark(null)
          post({ type: 'set-mode', mode: 'off' })
          break
        case 'command-result': {
          // Agent-control reply: resolve the matching runCommand() promise.
          const resolve = pendingCommandsRef.current.get(data.commandId)
          if (resolve) {
            pendingCommandsRef.current.delete(data.commandId)
            resolve({
              ok: data.ok,
              result: data.result,
              error: data.error,
              errorCode: data.errorCode,
            })
          }
          break
        }
        case 'error':
          // Probe-side failure (it runs in the preview's realm — this is our only window into
          // it). Non-fatal: the probe keeps running. It goes to the centre rather than the
          // console because "clicked but nothing happened" is a report a person files, not one
          // a developer reads devtools for.
          reportProbeProblem(data.message)
          probeProblemRef.current = true
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [iframeRef, post])

  // Forward theme changes to the probe (so the in-page overlay matches the app).
  useEffect(() => {
    return themeVarsBus.subscribe((vars) => {
      if (channelRef.current) post({ type: 'theme', vars: toVfVars(vars) })
    })
  }, [post])

  // A preview reload swaps contentWindow → the old channel is dead until the new
  // probe handshakes. Reset connection when the iframe element identity changes is
  // handled implicitly by the next `ready`; we just clear stale UI here on unmount.
  useEffect(
    () => () => {
      channelRef.current = null
      for (const resolve of pendingCommandsRef.current.values()) {
        resolve({ ok: false, notEngaged: true, error: 'The preview was closed.' })
      }
      pendingCommandsRef.current.clear()
      for (const resolve of connectionWaitersRef.current) resolve(false)
      connectionWaitersRef.current = []
    },
    [],
  )

  const setMode = useCallback(
    (next: VfMode) => {
      setModeState(next)
      modeRef.current = next
      if (next === 'off') {
        setPending(null)
        setOpenedMark(null)
      }
      post({ type: 'set-mode', mode: next })
    },
    [post],
  )

  const clearPending = useCallback(() => {
    setPending(null)
    setOpenedMark(null)
    post({ type: 'clear' })
  }, [post])

  const clearOpenedMark = clearPending

  const setMarks = useCallback(
    (marks: VfMark[]) => {
      marksRef.current = marks
      post({ type: 'set-marks', marks })
    },
    [post],
  )

  // The iframe navigated (reload / proxy swap / version bump): the channel is dead
  // until the new page's probe handshakes. Drop connection + any anchored composer
  // so the UI reflects reality — a page WITHOUT a probe (e.g. a direct external dev
  // server) correctly stays "disconnected". modeRef is kept, so the next
  // `ready` re-syncs it automatically.
  const notifyReload = useCallback(() => {
    channelRef.current = null
    setConnected(false)
    // A comment being written outlives the navigation; the next `ready` re-finds its element.
    for (const resolve of pendingCommandsRef.current.values()) {
      resolve({ ok: false, notEngaged: true, error: 'The preview navigated before replying.' })
    }
    pendingCommandsRef.current.clear()
  }, [])

  const reveal = useCallback(
    (selector: string) => {
      if (selector) post({ type: 'reveal', selector })
    },
    [post],
  )

  // Relay one agent command to the probe and resolve with its result. Resolves
  // `notEngaged` immediately when no probe is connected (so the agent gets a clear
  // "open the preview" message instead of waiting out the server timeout), and
  // guards with its own timeout in case the probe never replies.
  const runCommand = useCallback(
    (commandId: string, command: VfCommand): Promise<VfCommandReply> => {
      const ch = channelRef.current
      const win = iframeRef.current?.contentWindow
      if (!ch || !win)
        return Promise.resolve({
          ok: false,
          notEngaged: true,
          error: 'No preview probe is connected.',
        })
      return new Promise<VfCommandReply>((resolve) => {
        const timer = setTimeout(() => {
          if (pendingCommandsRef.current.delete(commandId)) {
            resolve({
              ok: false,
              error: 'The preview did not respond in time.',
              errorCode: 'failed',
            })
          }
        }, 10_000)
        pendingCommandsRef.current.set(commandId, (reply) => {
          clearTimeout(timer)
          resolve(reply)
        })
        win.postMessage({ type: 'command', commandId, command, [VF_BRIDGE_KEY]: ch }, '*')
      })
    },
    [iframeRef],
  )

  // Resolve once the probe is connected (channelRef is the live source of truth —
  // `connected` state can lag). Used by the agent-control relay to wait out a fresh
  // proxy engage / a slow handshake before sending a command.
  const whenConnected = useCallback((timeoutMs = 12_000): Promise<boolean> => {
    if (channelRef.current) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const waiter = (ok: boolean) => {
        clearTimeout(timer)
        resolve(ok)
      }
      const timer = setTimeout(() => {
        connectionWaitersRef.current = connectionWaitersRef.current.filter((w) => w !== waiter)
        resolve(false)
      }, timeoutMs)
      connectionWaitersRef.current.push(waiter)
    })
  }, [])

  // Rasterize one element in-page via the probe (reuses the agent command path).
  // Returns the JPEG (base64) the probe rendered, or null. No permission needed.
  const captureElement = useCallback(
    async (selector: string): Promise<VfImage | null> => {
      const id = `host_${++cmdSeqRef.current}`
      const reply = await runCommand(id, { action: 'screenshot', selector })
      return reply.ok ? (reply.result?.image ?? null) : null
    },
    [runCommand],
  )

  return {
    connected,
    mode,
    pending,
    setMode,
    clearPending,
    setMarks,
    openedMark,
    clearOpenedMark,
    notifyReload,
    reveal,
    runCommand,
    whenConnected,
    captureElement,
  }
}

/**
 * Map host theme vars → the probe's collision-free `--vf-*` namespace. We forward ONLY the
 * overlay's own colours, never the generic palette — setting `--primary`/`--background` on the
 * previewed page would restyle the user's app, which we must not do.
 *
 * The accent is the app's info hue, not its primary. The app is monochrome: `--primary` is near
 * white in the dark theme and near black in the light one, and the page under the overlay is
 * neither app's — a white outline and a 12% white tint vanished on a light page entirely. A
 * chromatic accent reads on either, and the dark/light halo keeps its edge crisp on both.
 */
function toVfVars(host: Record<string, string>): Record<string, string> {
  const accent = host['--status-info'] || host['--primary']
  return accent ? { '--vf-accent': accent, '--vf-accent-foreground': '#fff' } : {}
}
