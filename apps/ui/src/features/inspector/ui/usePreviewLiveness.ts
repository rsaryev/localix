import { useCallback, useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { adoptTerminal } from '@/features/terminal/model/terminalTabs'
import { toast } from '@/shared/lib/notify'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { useProblemReport, type OwnedProblemReport } from '@/shared/ui/problem-report'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { pingPreviewUrl, pollPreviewUrl } from '../model/previewPing'
import { watchPreviewLiveness } from '../model/previewLivenessClient'

/** Namespace for the conditions a preview publishes about its server. */
const PROBLEM_SCOPE = 'preview'

// How long to wait for a relaunched dev server to answer before giving up — past
// this the command almost certainly failed (wrong cwd, missing deps, bad port),
// so we stop spinning, surface an error, and reveal its terminal logs.
const START_TIMEOUT_MS = 25_000

export type PreviewLivenessStatus = 'running' | 'stopped'

interface PreviewLivenessOptions {
  /** False while a keep-alive preview body is mounted but hidden. */
  active?: boolean
  url: string
  /** Bumped by the backend when the model re-opens the same preview — re-asks + reloads. */
  version: number
  sessionId: string | null
  /** Shell command that started a dev server — relaunched on demand. */
  startCommand?: string
  startCwd?: string
  /** The server came back after being down: the frame is about to reload. */
  onRecover?: () => void
  /**
   * Test seam: how this pane learns about the endpoint. Production passes the socket
   * subscription; a test passes a stub rather than opening a real websocket.
   */
  watch?: typeof watchPreviewLiveness
}

export interface PreviewLiveness {
  status: PreviewLivenessStatus
  /**
   * This url+version has been answered for at least once. Nothing is WITHHELD on it — a pane
   * that waits for an answer is a blank pane whenever the answer is slow — but the guards
   * that only make sense against a live frame (the no-white-screen timeout) wait for it.
   */
  probed: boolean
  /** True from "Start server" click until the watch sees it return (or a reload). */
  starting: boolean
  /** Set when a relaunch failed or gave up — the command likely failed; logs revealed. */
  startProblem: OwnedProblemReport | null
  /** PTY id of a server WE launched (null otherwise) — drives the Stop button. */
  startedTerminalId: string | null
  /** Local reload counter — distinct from `version`; remount the iframe via its key. */
  nonce: number
  reload: () => void
  startServer: () => void
  stopServer: () => void
}

/**
 * Is the page's SERVER up, and how to bring a dev server back. Where the page is served
 * from (the proxy, a re-served file) is the neighbouring {@link usePreviewEndpoint}'s
 * question; this one is only about the upstream the person's app runs on.
 *
 * The answer is the API's, pushed over the socket: it watches the endpoint once for the
 * whole machine with a TCP connect, and a dev server it spawned reports its own exit the
 * moment the PTY dies. An endpoint the API will not watch (not loopback or private, or an
 * older server) answers `watchable: false`, and only then does the pane ask for itself,
 * cache-bypassing. When the server goes down `status` flips; when it comes back the `nonce`
 * bumps so the iframe reloads, and `onRecover` fires so the frame's address is re-resolved.
 */
export function usePreviewLiveness({
  active = true,
  url,
  version,
  sessionId,
  startCommand,
  startCwd,
  onRecover,
  watch = watchPreviewLiveness,
}: PreviewLivenessOptions): PreviewLiveness {
  const [status, setStatus] = useState<PreviewLivenessStatus>('running')
  const [starting, setStarting] = useState(false)
  // A server that will not come back is a standing condition, so the reason has to survive
  // the person looking somewhere else — hence a report, not a toast.
  const [startFailure, setStartFailure] = useState<Problem | null>(null)
  const [startedTerminalId, setStartedTerminalId] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // Keyed by the target rather than reset in an effect: a re-point or a re-open is a new
  // question about a new port, while merely hiding and re-showing a warm preview is not.
  const probeKey = `${url}|${version}`
  const [probedKey, setProbedKey] = useState<string | null>(null)
  // Read at call time: re-subscribing to the server on every new callback identity would
  // re-ask it on every render of the owner.
  const onRecoverRef = useRef(onRecover)
  useEffect(() => {
    onRecoverRef.current = onRecover
  })

  // Ask before reloading, rather than assuming the reload will find something. Remounting
  // the iframe at a dead url repaints the page from the browser's cache, so an optimistic
  // reload looked like it worked on a server that had been killed minutes earlier.
  const reload = useCallback(() => {
    setStartFailure(null)
    void pingPreviewUrl(url).then((alive) => {
      setStatus(alive ? 'running' : 'stopped')
      setProbedKey(probeKey)
      if (alive) setNonce((n) => n + 1)
    })
  }, [url, probeKey])

  // Relaunch a stopped dev server: rerun its remembered start command in a PTY in the
  // session workspace (we adopt the pane so its logs are reachable). The watch then sees
  // the port answer and clears the overlay.
  const startServer = useCallback(() => {
    // The server runs in THIS preview's chat workspace; a preview that belongs to no chat has no
    // workspace to relaunch it in.
    if (!startCommand || !sessionId) return
    setStartFailure(null)
    setStarting(true)
    void backendClient
      .spawnTerminalCommand({
        sessionId,
        command: startCommand,
        ...(startCwd ? { cwd: startCwd } : {}),
      })
      .then(({ terminalId, cwd }) => {
        setStartedTerminalId(terminalId)
        // Pre-attach the dev-server terminal hidden; revealed on demand / on failure.
        adoptTerminal({
          terminalId,
          sessionId,
          title: 'Dev server',
          cwd: cwd ?? startCwd,
          command: startCommand,
          reveal: false,
        })
      })
      .catch((error: unknown) => {
        setStarting(false)
        setStartFailure({
          message: 'Could not launch the server command.',
          detail: errorMessage(error, '') || undefined,
          field: startCommand,
        })
      })
  }, [startCommand, startCwd, sessionId])

  // Give up if a relaunched dev server never answers: the command most likely failed (the
  // cwd lacks deps, the port differs, the script is wrong). Stop the infinite "Starting…",
  // surface an error, and REVEAL the server's terminal so the actual failure is right there.
  useEffect(() => {
    if (!starting || !startedTerminalId || !sessionId) return
    const timer = setTimeout(() => {
      setStarting(false)
      setStatus('stopped')
      setStartFailure({
        message: "The server didn't come up.",
        hint: 'Check its terminal logs for the error.',
      })
      terminalBus.openJob({ terminalId: startedTerminalId, sessionId, title: 'Dev server' })
    }, START_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [starting, startedTerminalId, sessionId])

  // Stop a server WE launched: kill its PTY (the dev server dies → the port goes away → the
  // watch flips the overlay to "stopped"). Optimistically mark it stopped so the UI reacts now.
  const stopServer = useCallback(() => {
    const id = startedTerminalId
    if (!id) return
    setStartedTerminalId(null)
    setStarting(false)
    setStatus('stopped')
    void backendClient.closeTerminal(id).catch((error: unknown) =>
      toast.error('Could not stop the preview server', {
        description: errorMessage(error, '') || undefined,
      }),
    )
  }, [startedTerminalId])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let stopFallback: (() => void) | null = null
    // The last liveness observed within this effect run, so a down→up transition reloads the
    // iframe exactly once (no render-time ref).
    let down = false
    const settle = (alive: boolean) => {
      if (cancelled) return
      if (alive) {
        if (down) {
          down = false
          setNonce((n) => n + 1) // server came back — reload the iframe
          onRecoverRef.current?.()
        }
        setStatus('running')
        setStarting(false)
        setStartFailure(null)
      } else {
        down = true
        setStatus('stopped')
      }
      // Answered either way, so the frame may be shown.
      setProbedKey(probeKey)
    }
    const release = watch(url, (update) => {
      if (cancelled) return
      if (!update.watchable) {
        stopFallback ??= pollPreviewUrl(url, settle)
        return
      }
      // `null` is "no answer yet", which must not be shown as a stopped server.
      if (update.alive !== null) settle(update.alive)
    })
    return () => {
      cancelled = true
      release()
      stopFallback?.()
    }
  }, [active, url, version, probeKey, watch])

  const startProblem = useProblemReport(
    startFailure
      ? {
          subject: { label: 'Preview server' },
          problems: [startFailure],
          consequence: 'blocked',
        }
      : null,
    {
      scope: PROBLEM_SCOPE,
      sourceVisible: active,
      // The centre row can bring the server back on its own; the overlay may be behind a tab the
      // person closed by the time they read it.
      actions: [
        { id: 'restart', label: 'Restart', run: startServer },
        { id: 'reload', label: 'Reload', run: reload },
      ],
    },
  )

  return {
    status,
    probed: probedKey === probeKey,
    starting,
    startProblem,
    startedTerminalId,
    nonce,
    reload,
    startServer,
    stopServer,
  }
}
