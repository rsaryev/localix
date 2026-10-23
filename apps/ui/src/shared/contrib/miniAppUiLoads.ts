import type { MiniAppRecord } from '@/shared/api/contracts'
import {
  cancelStartupRetry,
  scheduleStartupRetry,
  startupRetryDelay,
  type StartupRetryCancel,
  type StartupRetrySchedule,
} from '@/shared/lib/startupRetry'

/**
 * Which enabled mini apps' UI is still due in this page, who owns settling it, and the retry of a
 * first load that failed — split out of `enabledMiniApps.ts`, which owns the capability snapshot.
 *
 * Each rule answers a failure:
 *  - A FAILED import is not a settle. It was counted as one, so once the other mini apps loaded,
 *    activation read as authoritative, the mini app's restored tabs read as unavailable and were
 *    closed, and the grid was re-saved without them: a 503 while the sidecar restarted deleted
 *    tabs for good. A failed first load stays `loading` and the pass retries it with the startup
 *    backoff; past the budget it is `failed`, which still keeps its tabs until the next publish
 *    tries again.
 *  - Ownership moves at PUBLISH, not at request start. A request that started later but never
 *    published (the one-shot refetch on socket connect, failing) used to disown the pass that did
 *    publish, so its settles were dropped and the mini app stayed pending forever.
 */

/** Told as each mini app's UI work ends; `ok` is whether its wanted revision is now registered. */
export type MiniAppUiSettled = (miniAppName: string, ok: boolean) => void

/** Converge mini app UI on the snapshot's mini app records (the runtime keeps the enabled ones). */
export type MiniAppUiDiscovery = (
  miniApps: readonly MiniAppRecord[],
  settled?: MiniAppUiSettled,
) => Promise<void>

/** Further passes a failed first load gets (100 ms … 5 s apart, ~9.5 s in all) before `failed`. */
const UI_RETRY_BUDGET = 7

/** Mini apps whose UI registered at least once in this page; a later pass is not a first load. */
const everLoaded = new Set<string>()
let loading = new Set<string>()
let failed = new Set<string>()
let owner = 0
let stopRetry: (() => void) | null = null

export function miniAppUiPending(): { loading: ReadonlySet<string>; failed: ReadonlySet<string> } {
  return { loading, failed }
}

/**
 * Take ownership for a publish of `miniApps`, before it: the first loads it still owes become
 * `loading`, and any earlier pass — its settles and its retry timer — is disowned.
 */
export function claimMiniAppUiLoads(miniApps: readonly MiniAppRecord[]): number {
  owner += 1
  stopRetry?.()
  stopRetry = null
  const withUi = new Set(miniApps.flatMap((p) => (p.enabled && p.ui ? [p.name] : [])))
  // A mini app that left is unloaded by the runtime; enabling it again is a first load again.
  for (const name of everLoaded) if (!withUi.has(name)) everLoaded.delete(name)
  loading = new Set([...withUi].filter((name) => !everLoaded.has(name)))
  failed = new Set()
  return owner
}

/**
 * Run the owning publish's UI passes: the first now, then — while a first load keeps failing —
 * retries on the startup backoff. Resolves when the FIRST pass ends. `changed` hears every
 * transition of the pending sets and is told when nothing is loading any more.
 */
export async function runMiniAppUiLoads(
  claim: number,
  miniApps: readonly MiniAppRecord[],
  discover: MiniAppUiDiscovery,
  changed: (drained: boolean) => void,
  schedule: StartupRetrySchedule = scheduleStartupRetry,
  cancel: StartupRetryCancel = cancelStartupRetry,
): Promise<void> {
  const owns = () => claim === owner
  const failedThisPass = new Set<string>()
  const settled: MiniAppUiSettled = (name, ok) => {
    if (!owns()) return
    if (!ok) {
      if (loading.has(name)) failedThisPass.add(name)
      return
    }
    everLoaded.add(name)
    if (loading.delete(name) || failed.delete(name)) changed(loading.size === 0)
  }
  /** One pass; true when no first load failed in it (or the pass is no longer ours). */
  const pass = async (): Promise<boolean> => {
    failedThisPass.clear()
    try {
      await discover(miniApps, settled)
    } catch {
      // The runtime itself did not load (a chunk error): every first load it owed failed.
      for (const name of loading) failedThisPass.add(name)
    }
    return !owns() || failedThisPass.size === 0
  }
  const retry = (attempt: number) => {
    const timer = schedule(() => {
      if (!owns()) return
      void pass().then((done) => {
        if (done) return
        if (attempt + 1 < UI_RETRY_BUDGET) return retry(attempt + 1)
        for (const name of failedThisPass) {
          loading.delete(name)
          failed.add(name)
        }
        changed(loading.size === 0)
      })
    }, startupRetryDelay(attempt))
    stopRetry = () => cancel(timer)
  }
  if (!(await pass())) retry(0)
}

/** Test seam: forget every load (does not notify). */
export function __resetMiniAppUiLoads(): void {
  claimMiniAppUiLoads([])
  everLoaded.clear()
}
