import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'

/**
 * ONE coalesced signal for "a host registry changed" — a mini app registered or removed a
 * contribution, a mini app's first UI load settled, a dev rebuild replaced a module.
 *
 * Two defects shaped it. Surfaces that read a registry during render (a restored mini app tab, a
 * tab icon, a session surface such as a poller, a diff slot, an editor enhancer) re-read only
 * when something ELSE re-rendered them, so a restored tab sat on "Restoring…" until an unrelated
 * bump and a closed-and-reopened panel was the only thing that "fixed" it. And the signal that did
 * exist fired once PER MINI APP: each settle re-rendered the whole app, which a startup trace
 * measured as one ~55 ms long task per mini app, twenty back to back.
 *
 * So registry state changes synchronously (a reader always sees the current registry), and the
 * NOTIFICATION is deferred to the next frame: every change in the burst — N mini apps registering,
 * N settles — produces exactly one flush. The flush runs each queued follow-up once (deduped by
 * identity: the activation broadcast, the capability store's re-announce) and then wakes the
 * registry listeners, which `useMiniAppRegistrySlice` narrows so only a consumer whose slice
 * actually moved re-renders.
 */

type Flush = () => void

let version = 0
const listeners = new Set<() => void>()
const followUps = new Set<Flush>()
let scheduled: (() => void) | null = null

/**
 * The frame the flush waits for. A hidden window never runs animation frames, so a timeout
 * backs it: a registry must still settle while the app is minimised at launch.
 */
const HIDDEN_WINDOW_FALLBACK_MS = 100
function scheduleFrame(flush: Flush): () => void {
  const timeout = globalThis.setTimeout(flush, HIDDEN_WINDOW_FALLBACK_MS)
  const { requestAnimationFrame: request, cancelAnimationFrame: cancel } = globalThis
  if (typeof request !== 'function' || typeof cancel !== 'function')
    return () => clearTimeout(timeout)
  const frame = request(() => flush())
  // The pair the frame was asked of: a window gone by the time it is let go took its own away.
  return () => {
    clearTimeout(timeout)
    cancel(frame)
  }
}
let schedule: (flush: Flush) => () => void = scheduleFrame

/** Record a registry change now; notify once with the rest of this burst. */
export function noteRegistryChange(followUp?: Flush): void {
  version += 1
  if (followUp) followUps.add(followUp)
  scheduled ??= schedule(flushRegistryChanges)
}

/**
 * A registration façade whose every seam notes a registry change after it registers.
 *
 * Wrapping the FAÇADE (`host.ts`) rather than each registry makes the note total: a seam added to
 * the interface is announced without anyone remembering to. Missing one is how a mini app that
 * registered after the first paint stayed invisible under an open tab or surface.
 */
export function announcing(host: MiniAppUiHost): MiniAppUiHost {
  type Seam = { register: (...args: never[]) => unknown }
  const seams = Object.entries(host as unknown as Record<string, Seam>).map(([name, seam]) => [
    name,
    {
      register: (...args: never[]) => {
        try {
          return seam.register(...args)
        } finally {
          noteRegistryChange()
        }
      },
    },
  ])
  return Object.fromEntries(seams) as MiniAppUiHost
}

/** Run the pending notification now (the scheduled frame, or a test). */
export function flushRegistryChanges(): void {
  scheduled?.()
  scheduled = null
  const queued = [...followUps]
  followUps.clear()
  for (const followUp of queued) followUp()
  for (const listener of listeners) listener()
}

/** Monotonic count of registry changes — a staleness key for a cached slice. */
export function registryChangeVersion(): number {
  return version
}

export function subscribeRegistryChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam: replace the frame scheduler (`null` restores it) and drop anything pending. */
export function __setRegistryFlushScheduler(next: ((flush: Flush) => () => void) | null): void {
  scheduled?.()
  scheduled = null
  followUps.clear()
  schedule = next ?? scheduleFrame
}
