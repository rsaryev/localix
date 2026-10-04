import { useCallback, useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useProblemReport, type OwnedProblemReport } from '@/shared/ui/problem-report'
import { usePreviewStore } from '../model/previewStore'

/** Namespace for the conditions a preview publishes about its server. */
const PROBLEM_SCOPE = 'preview'

// Stable module-level defaults (an inline default would be a new identity per render and
// re-run the effects that depend on it).
const resolveFromApi: typeof backendClient.resolvePreview = (input) =>
  backendClient.resolvePreview(input)
const reconnectFromSocket: typeof eventSocket.onReconnect = (handler) =>
  eventSocket.onReconnect(handler)

interface PreviewEndpointOptions {
  /** False while a keep-alive preview body is mounted but hidden. */
  active?: boolean
  url: string
  /** Bumped by the backend when the model re-opens the same preview. */
  version: number
  sessionId: string | null
  /** Auto-served static file: the directory we serve, re-served when its port is gone. */
  rootDir?: string
  /** Entry file the API auto-serves (e.g. "index.html"). */
  servedFile?: string
  /** Liveness says the page's server is down — a static file is then re-served on its own. */
  stopped: boolean
  /** Test seams. */
  resolve?: typeof backendClient.resolvePreview
  onReconnect?: typeof eventSocket.onReconnect
}

export interface PreviewEndpoint {
  /**
   * True once THIS url+version has been answered by the live API process. The frame is
   * withheld until then, because the only alternative address is a stored port that may
   * belong to a process that no longer exists.
   */
  ready: boolean
  /** Probe-injecting proxy for an external server (never for an auto-served file). */
  injectUrl: string | undefined
  /** Bumped by every fresh answer; part of the frame's identity so a new port remounts it. */
  epoch: number
  resolving: boolean
  /** The endpoint cannot be brought back (the served file is gone, the API refused the url). */
  problem: OwnedProblemReport | null
  /** Ask again — after a wake, or from a recovery action. */
  refresh: () => void
}

interface Resolved {
  key: string
  injectUrl: string | undefined
  epoch: number
}

/**
 * Where the preview's frame should point RIGHT NOW.
 *
 * Both in-process preview servers — the static file server and the probe-injecting proxy in
 * front of a dev server — bind an ephemeral port that dies with the API process. The pane
 * used to persist that port and mount it: after a dev reload the proxy was gone, the app it
 * fronted (`localhost:8000`, say) was still up, so liveness read "running" and the pane was a
 * white frame with nothing to say. Here the address is a QUESTION asked of the live process:
 * on mount, on every re-open, on every socket reconnect (the one way the pane learns the API
 * restarted), and once whenever liveness flips to down for a file we serve ourselves.
 */
export function usePreviewEndpoint({
  active = true,
  url,
  version,
  sessionId,
  rootDir,
  servedFile,
  stopped,
  resolve = resolveFromApi,
  onReconnect = reconnectFromSocket,
}: PreviewEndpointOptions): PreviewEndpoint {
  const key = `${url}|${version}`
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [resolving, setResolving] = useState(false)
  const [failure, setFailure] = useState<Problem | null>(null)
  // Incremented to ask again for the same key (reconnect, wake, recovery action).
  const [ask, setAsk] = useState(0)
  const refresh = useCallback(() => setAsk((n) => n + 1), [])

  const isAutoServed = !!rootDir && !!servedFile

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setResolving(true)
    setFailure(null)
    void resolve({ url, rootDir, servedFile })
      .then((answer) => {
        if (cancelled) return
        setResolving(false)
        // A re-served file came back on a new port: re-point the entry (the store bumps the
        // version, so the next effect run resolves the new key and settles there).
        if (isAutoServed && answer.url !== url) {
          if (sessionId) {
            usePreviewStore.getState().repointActivePreview(sessionId, answer.url, answer.previewId)
          }
          return
        }
        setResolved((prev) => ({
          key,
          injectUrl: answer.injectUrl,
          epoch: (prev?.epoch ?? 0) + 1,
        }))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setResolving(false)
        setFailure(
          isAutoServed
            ? {
                message: 'Could not re-serve this preview file.',
                hint: 'The file may have moved or been deleted since the preview was opened.',
                detail: errorMessage(error, '') || undefined,
              }
            : {
                message: 'Could not reach the preview through the app.',
                hint: 'The app’s server may be restarting; it retries once it reconnects.',
                detail: errorMessage(error, '') || undefined,
              },
        )
      })
    return () => {
      cancelled = true
    }
  }, [active, key, url, version, ask, rootDir, servedFile, isAutoServed, sessionId, resolve])

  // The API came back: whatever port it handed out before is gone with the old process.
  useEffect(() => {
    if (!active) return
    return onReconnect(() => setAsk((n) => n + 1))
  }, [active, onReconnect])

  // A file WE serve went dark: its server died with the process, so re-serving is the whole
  // repair and needs no click. Once per down period — the flip to `stopped` is the trigger,
  // not the state, so a file that is truly gone does not loop on its own failure.
  useEffect(() => {
    if (!active || !stopped || !isAutoServed) return
    setAsk((n) => n + 1)
  }, [active, stopped, isAutoServed])

  const problem = useProblemReport(
    failure
      ? { subject: { label: 'Preview server' }, problems: [failure], consequence: 'blocked' }
      : null,
    {
      scope: PROBLEM_SCOPE,
      sourceVisible: active,
      actions: [{ id: 'retry', label: 'Try again', run: refresh }],
    },
  )

  return {
    ready: resolved?.key === key,
    injectUrl: resolved?.key === key ? resolved.injectUrl : undefined,
    epoch: resolved?.epoch ?? 0,
    resolving,
    problem,
    refresh,
  }
}
