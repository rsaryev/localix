import { platformCapabilities } from './platformCapabilities'

/**
 * The desktop shell's startup barrier.
 *
 * The packaged app spawns its API as a child process and paints the webview
 * IMMEDIATELY — by design, so the window is up in one frame instead of after a
 * cold sidecar boot. Measured against the shipped build's own log, that sidecar
 * needs ~0.8s warm and ~3.8s cold. Everything the UI reads at startup used to
 * fire into that gap: ten independent bootstrap loops, each failing, each
 * starting its own backoff, and the workspace strip flashing a red "could not be
 * loaded" for a service that was never down.
 *
 * The shell already announces the transition (`window.__LOCALIX_RUNTIME_STATUS`
 * plus a `localix-runtime-status` event). This module turns that announcement
 * into ONE barrier every startup read crosses, so a not-yet-listening sidecar
 * costs zero failed requests and zero error UI.
 *
 * Nothing here is OS-specific: the barrier keys off the shell's own signal, which
 * every Tauri target publishes the same way.
 */

export type RuntimeStatus = 'starting' | 'ready' | 'error'

export const RUNTIME_STATUS_EVENT = 'localix-runtime-status'

/**
 * Upper bound on how long a read waits for the shell.
 *
 * A barrier with no cap would turn a shell that never publishes into a
 * permanently empty app — strictly worse than the failing-and-retrying behaviour
 * it replaces. On expiry the barrier opens and every caller proceeds exactly as
 * it did before this module existed.
 *
 * Sized to outlast the shell's OWN supervision rather than to a number that feels
 * about right: `sidecar.rs` gives each attempt 12s (`READY_TIMEOUT_SECS`) and takes
 * two (`READY_ATTEMPTS`), so it always publishes `ready` or `error` within ~24s plus
 * a respawn. Expiring before that would start hammering a port while the shell's
 * retry was still on its way to fixing it.
 */
export const RUNTIME_START_CAP_MS = 45_000

/**
 * The shell's current view of its API child, or `undefined` outside the packaged
 * shell (a browser tab, or `tauri dev`, where the API is the developer's own
 * daemon and no initialization script is injected).
 */
export function runtimeStatus(): RuntimeStatus | undefined {
  if (typeof window === 'undefined') return undefined
  return window.__LOCALIX_RUNTIME_STATUS
}

/** The shell's failure detail, or `null` unless it reported `error`. */
export function runtimeErrorMessage(): string | null {
  if (runtimeStatus() !== 'error') return null
  return window.__LOCALIX_RUNTIME_ERROR ?? 'The local service could not start.'
}

export function subscribeRuntimeStatus(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(RUNTIME_STATUS_EVENT, listener)
  return () => window.removeEventListener(RUNTIME_STATUS_EVENT, listener)
}

let pending: Promise<void> | null = null
let resyncRequested = false

/**
 * Ask the shell to replay its recorded status.
 *
 * The handoff is a fire-and-forget `eval`, so a sidecar that becomes ready BEFORE
 * the document exists delivers its announcement to nothing and the page is left
 * reading the `starting` its initialization script wrote. One replay closes that
 * race; the shell's script is idempotent, so asking when nothing changed costs a
 * no-op. Absent (older shell, or no shell at all) it resolves to `null` and the
 * cap below remains the safety net.
 */
function requestShellResync(): void {
  if (resyncRequested) return
  resyncRequested = true
  void platformCapabilities()
    .desktop.invoke('resync_runtime_status')
    ?.catch(() => {})
}

/**
 * Development's barrier, because a dev build has no shell to announce readiness.
 *
 * `tauri dev` and `dev:workspace` start the API and Vite side by side, and the page
 * paints while the API is still booting. With no barrier every startup read failed
 * into the retry ladder, whose later steps are 5s and 10s: one measured launch
 * reached `miniApps.ready` 19.7s after paint, after 5–8 failed requests, for an API
 * that was answering within ~2s. So a dev build polls the API's own `/health` — the
 * origin the launcher attests, armed by `shared/api/internal.ts` — at a short
 * interval, once, and then stays open: an API restart later is the ladder's job.
 * Production builds compile this branch out (`import.meta.env.DEV`).
 */
const DEV_HEALTH_POLL_MS = 100
let devHealthUrl: string | null = null
let devApiSeen = false

export function armDevApiHealth(url: string): void {
  devHealthUrl = url
}

function devApiBarrier(): Promise<void> | null {
  const url = devHealthUrl
  if (devApiSeen || !url) return null
  pending ??= new Promise<void>((resolve) => {
    const deadline = Date.now() + RUNTIME_START_CAP_MS
    const poll = async (): Promise<void> => {
      const up = await globalThis
        .fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(1_000) })
        .then(
          (response) => response.ok,
          () => false,
        )
      // The cap keeps a dev API that never comes up from freezing the app, exactly as above.
      if (!up && Date.now() < deadline)
        return void setTimeout(() => void poll(), DEV_HEALTH_POLL_MS)
      devApiSeen = true
      pending = null
      resolve()
    }
    void poll()
  })
  return pending
}

/**
 * `null` — the allocation-free fast path — whenever there is nothing to wait for:
 * a browser tab on a production build, or a shell that already reported
 * `ready`/`error`. An `error` deliberately does NOT hold reads back: the failure is
 * already on screen and a caller that wants to retry should be allowed to.
 *
 * Otherwise a single shared promise that settles when the shell leaves `starting`
 * (or, in development, when the API first answers `/health`).
 */
export function runtimeReadyBarrier(): Promise<void> | null {
  if (import.meta.env.DEV && runtimeStatus() === undefined) return devApiBarrier()
  if (runtimeStatus() !== 'starting') return null
  if (pending) return pending

  pending = new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timer)
      pending = null
      resolve()
    }
    const unsubscribe = subscribeRuntimeStatus(() => {
      if (runtimeStatus() !== 'starting') finish()
    })
    const timer = setTimeout(finish, RUNTIME_START_CAP_MS)
    requestShellResync()
  })
  return pending
}

/** Test seam: forget the in-flight barrier (does not settle waiters). */
export function __resetRuntimeReady(): void {
  pending = null
  resyncRequested = false
  devHealthUrl = null
  devApiSeen = false
}
