import type { MiddlewareHandler } from 'hono'

/**
 * A plugin's route answered 404 for the first seconds of every launch.
 *
 * The API reports READY once it listens, and the page starts at once; its plugin UIs load in about
 * a second and immediately call their own routes (`/rpc/<plugin>/…`).
 * Those routes only exist once the backend host's first reconcile has wired the plugins, which
 * waits for the login-shell environment and measured ~3.3 s into a packaged launch. Every call in
 * that window got a 404, which a plugin reads as "not here": Git showed "not a repository" and
 * stopped polling, and only reopening the panel — a new request, after the wiring — recovered it.
 *
 * So a request that NOTHING answered (the core routes ran and returned 404) while the first
 * reconcile is still pending waits for that reconcile, bounded, and is then offered to the plugin
 * routes once more. Core routes never wait: they answer before this looks at anything, and a 404
 * after the first reconcile is final at once.
 */
export const FIRST_RECONCILE_WAIT_MS = 15_000

/** Whether the backend host's first reconcile has run (wired or failed), and when it does. */
export interface FirstReconcile {
  done: () => boolean
  settled: Promise<void>
}

/** The signal `startBackendHost` marks when the first reconcile ends, however it ends. */
export function createFirstReconcileSignal(): FirstReconcile & { mark: () => void } {
  let done = false
  let resolveSettled: () => void = () => {}
  const settled = new Promise<void>((resolve) => (resolveSettled = resolve))
  return {
    done: () => done,
    settled,
    mark: () => {
      done = true
      resolveSettled()
    },
  }
}

export interface PluginRouteHost {
  /** The backend host's stable route dispatcher (`backend-host.ts` `middleware`). */
  middleware(): MiddlewareHandler
  firstReconcile: FirstReconcile
}

export function holdPluginRoutesUntilWired(
  host: PluginRouteHost,
  waitMs = FIRST_RECONCILE_WAIT_MS,
): MiddlewareHandler {
  const dispatch = host.middleware()
  return async (c, next) => {
    const answered = await dispatch(c, next)
    if (answered instanceof Response) return answered
    if (c.res.status !== 404 || host.firstReconcile.done()) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      host.firstReconcile.settled,
      new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs))),
    ])
    clearTimeout(timer)
    // Offered once more; a path no plugin mounts falls through to the 404 it already has.
    const retried = await dispatch(c, async () => {})
    if (retried instanceof Response) c.res = retried
    return undefined
  }
}
