import { backendClient } from '@/shared/api/client'
import {
  EMPTY_SNAPSHOT,
  sameEnabledNames,
  type MiniAppContribSnapshot,
} from './miniAppContribSnapshot'

export type { MiniAppContribSnapshot } from './miniAppContribSnapshot'
export { miniAppCapabilityVersion } from './capabilityVersion'
import type {
  CapabilitySnapshot,
  CapabilityToolSurface,
  MiniAppViewSpec,
  MiniAppRecord,
} from '@/shared/api/contracts'
import {
  cancelStartupRetry,
  scheduleStartupRetry,
  startStartupRetry,
  type StartupRetryCancel,
  type StartupRetrySchedule,
} from '@/shared/lib/startupRetry'
import { tauriFrontendLog } from '@/shared/lib/tauri'
import type * as SyncProblems from './miniAppSyncProblems'
import { syncThirdPartyViews, __resetThirdPartyViews } from './runtimeViews'
import { setEnabledMiniAppNames, setMiniAppUiPending } from './miniAppActivation'
import { noteRegistryChange } from './registryChanges'
import {
  __resetMiniAppUiLoads,
  claimMiniAppUiLoads,
  miniAppUiPending,
  runMiniAppUiLoads,
  type MiniAppUiDiscovery,
} from './miniAppUiLoads'
import { __resetCapabilityVersion, noteCapabilityDocument } from './capabilityVersion'
import { rememberShellCapabilities, type ShellCapabilitiesFrame } from '@/shared/lib/shellSnapshot'

/**
 * The LIVE capability set of the workbench's project — mini apps, their enabled names,
 * mini app views and the tool surface — as a tiny subscribe/version
 * external store (the `runtimeViews.ts` idiom). ChatPage used to fetch this once per
 * mount, so a mini app toggle only showed up after a page reload; now the server
 * publishes `resources.changed` once the backend host settles a re-wire, the runtime
 * calls {@link refetchMiniAppContrib}, and every gated surface (rail sections, palette
 * commands, workbench mounts, the Settings tool list) re-renders from here.
 *
 * ONE request feeds all of it: `GET /rpc/capabilities/snapshot`. It used to be three
 * (mini apps + views) plus an independent `GET /rpc/tools` owned by Settings,
 * and the two halves refreshed on DIFFERENT keys — which is exactly how disabling a
 * mini app could update the mini app list while its tools stayed listed as enabled.
 *
 * `enabledNames === null` means "not loaded yet" — gates treat it as disabled
 * (fail closed), exactly like the previous local-state shape they read.
 */

let snapshot: MiniAppContribSnapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()
let version = 0
/** Whether a caller installed a scoped loader; until then a bare resync has no scope to read. */
let loaderInstalled = false
let requestVersion = 0
let activeSyncGeneration = 0
// How many snapshot loads are in flight. A superseded request hands publication to
// its successor — this is how it checks that a successor actually EXISTS.
let inFlightRequests = 0
let activeProjectId: string | null | undefined
let stopActiveSync: (() => void) | null = null
/**
 * Names publish when the snapshot lands, not after the slowest UI artifact (that kept every name
 * gate empty for 0.5–1.3s); a restored tab of a not-yet-registered kind is held by the pending UI
 * loads instead (`miniAppUiLoads.ts`).
 */
const publishNames = (names: Set<string> | null) => {
  const { loading, failed } = miniAppUiPending()
  setEnabledMiniAppNames(names, loading, failed)
}
/**
 * Failure reporting (its log lines, the Event Center condition and its copy) matters only once a
 * sync has failed, so it is imported then and never costs the startup bundle. Calls are ordered:
 * each `then` joins the same module promise in the order the calls were made.
 */
let syncFailing = false
const syncProblems = (act: (problems: typeof SyncProblems) => void): void =>
  void import('./miniAppSyncProblems').then(act, () => {})

/**
 * A mini app's UI settled, gave up, or was replaced in place (a dev reload): surfaces keyed on the
 * enabled set or {@link miniAppContribVersion} must re-read. This used to notify once PER MINI APP,
 * each a full app re-render (~55 ms, twenty at startup); now the pending sets and the version are
 * current at once and the fresh set object rides the next registry flush, once per burst.
 */
export function announceMiniAppUiChanged(bumpVersion = true): void {
  if (snapshot.enabledNames === null) return
  if (bumpVersion) version += 1
  const { loading, failed } = miniAppUiPending()
  setMiniAppUiPending(loading, failed)
  noteRegistryChange(reannounceNames)
}
function reannounceNames(): void {
  if (snapshot.enabledNames === null) return
  snapshot = { ...snapshot, enabledNames: new Set(snapshot.enabledNames) }
  for (const l of listeners) l()
}

/**
 * Install a snapshot and notify. Subscribers reading the snapshot re-render on every
 * publish (the object identity changes); the `version` reload key — the one that makes
 * DEPENDENT endpoints refetch (plugin commands, skills, themes) — advances only when
 * the capability set actually moved.
 *
 * That gate is what makes a redundant poke cheap: a replayed `resources.changed` on
 * socket reconnect, or two pokes coalesced from a double toggle, both resolve to a
 * snapshot at a revision we already hold, and re-fetching four dependent catalogs for
 * it would be pure churn. The enabled-name comparison is the second half on purpose:
 * a mini app folder dropped straight onto disk changes what discovery returns WITHOUT
 * going through any service, so no revision bump announces it — keying only on the
 * server revision would leave those dependents stale.
 */

function publish(next: MiniAppContribSnapshot): void {
  const capabilitiesMoved =
    next.revision !== snapshot.revision ||
    !sameEnabledNames(snapshot.enabledNames, next.enabledNames)
  snapshot = next
  publishNames(next.enabledNames)
  syncThirdPartyViews(next.views)
  if (capabilitiesMoved) version += 1
  if (next.document) noteCapabilityDocument(next.document, next.enabledNames)
  for (const l of listeners) l()
  // This snapshot costs a mini-app-discovery round trip (measured: ~1.2s on a packaged
  // boot), and every gate treats "not loaded yet" as "disabled" — which is why the rail
  // starts empty and fills a second later. Record confirmed sets only, and only once the
  // project scope is established; `undefined` means we do not yet know whose they are.
  if (next.enabledNames && activeProjectId !== undefined) {
    rememberShellCapabilities(activeProjectId, {
      revision: next.revision,
      enabledNames: [...next.enabledNames],
      miniApps: next.miniApps,
      views: next.views,
      tools: next.tools,
    })
  }
}

/**
 * Paint the previous launch's capability set now, so the rail and the mini app surfaces are
 * whole in the first frame instead of appearing a second into the session.
 *
 * Deliberately NOT a version bump: this is the set we already believed, not news. The
 * dependent catalogs (commands, skills, themes) keep their existing keys and refetch only
 * when the server's answer actually differs — a restored frame that the server confirms
 * produces no extra work at all.
 *
 * The revision is carried through as-is so the first real answer can be compared against
 * it; `-1` (nothing loaded) is preserved for a snapshot written before any server revision
 * was known.
 */
export function restoreMiniAppContribFrame(
  projectId: string | null,
  frame: ShellCapabilitiesFrame,
): void {
  if (snapshot.enabledNames !== null) return
  activeProjectId = projectId
  snapshot = {
    document: null,
    enabledNames: new Set(frame.enabledNames),
    miniApps: frame.miniApps as MiniAppRecord[],
    views: frame.views as MiniAppViewSpec[],
    tools: frame.tools as CapabilityToolSurface | null,
    revision: frame.revision,
  }
  // Nothing of the frame's mini app UI is imported yet: every enabled artifact is a first load.
  claimMiniAppUiLoads(snapshot.miniApps)
  publishNames(snapshot.enabledNames)
  syncThirdPartyViews(snapshot.views)
  for (const l of listeners) l()
}

/**
 * Establish a new project boundary before any project-scoped catalog is read.
 *
 * A route transition used to preserve the previous project's mini app snapshot
 * until the new three-request discovery pass completed. During that window the
 * UI-location publisher could bind A's mini app destinations to B's immutable
 * catalog, and the Capabilities sidebar briefly rendered A's inventory in B.
 * Clear only on an actual scope change; transient failures inside one scope
 * still preserve its last known-good snapshot.
 */
export function prepareMiniAppContribScope(projectId: string | null): void {
  if (activeProjectId === projectId) return
  activeProjectId = projectId
  // Any request that started for the previous project loses publication rights, and the
  // previous scope's UI pass loses its settles.
  requestVersion += 1
  claimMiniAppUiLoads([])
  publish(EMPTY_SNAPSHOT)
  syncThirdPartyViews([])
}

export interface MiniAppContribSource {
  loadSnapshot: () => Promise<CapabilitySnapshot>
}

export type { MiniAppUiDiscovery } from './miniAppUiLoads'

// The mini app UI runtime stays out of first paint: which mini apps to load is only known once the
// snapshot resolves. A failed chunk import is forgotten, so the retry imports it again.
let miniAppUiDiscovery: Promise<MiniAppUiDiscovery> | undefined
const discoverMiniAppUiLazily: MiniAppUiDiscovery = (miniApps, settled) => {
  const loaded = (miniAppUiDiscovery ??= import('./miniAppUiDiscovery').then(
    ({ discoverEnabledMiniAppUi }) => discoverEnabledMiniAppUi,
    (error: unknown) => {
      miniAppUiDiscovery = undefined
      throw error
    },
  ))
  return loaded.then((discover) => discover(miniApps, settled))
}

export function miniAppContribSourceFor(projectId: string | null): MiniAppContribSource {
  return { loadSnapshot: () => backendClient.fetchCapabilitySnapshot({ projectId }) }
}
/**
 * What a NO-ARGUMENT refetch reads — the scope this store was prepared with, resolved
 * per call rather than frozen at module load.
 *
 * It used to be `miniAppContribSourceFor(null)`, a constant, so any caller that did not
 * hand in a source silently queried the GLOBAL scope. That is not a smaller answer, it
 * is a different one: mini apps carry their enabled state per project (an exact
 * `projectId:name` match, no fallback to the global row), so against the live API the
 * same install reports **4 of 19 mini apps enabled with no projectId and 13 of 17 with
 * one**. Every gated surface — rail sections, palette commands, workbench mounts —
 * reads `enabledNames`, so a snapshot taken in the wrong scope hides nine mini apps'
 * contributions until something refetches in the right one. Opening the Store
 * is exactly such a refetch, which is why those surfaces appeared only after visiting it.
 *
 * `prepareMiniAppContribScope` already records the scope synchronously at the route
 * boundary, before any sync starts. Reading it here makes every no-argument path
 * correct by construction instead of correct-if-someone-installed-the-right-loader-first.
 */
const defaultSource: MiniAppContribSource = {
  loadSnapshot: () => backendClient.fetchCapabilitySnapshot({ projectId: activeProjectId ?? null }),
}
let currentLoad: () => Promise<boolean> = () => refetchMiniAppContrib()

/**
 * Load the capability snapshot and reconcile every derived registry from it.
 * Fail closed BEFORE the first complete response: mini app UI remains hidden while
 * bootstrap retries. Once established, a transient transport failure preserves the
 * last authoritative snapshot instead of making every mini app disappear. Concurrent
 * calls are ordered by request start, so an older slow response cannot roll a newer
 * toggle back.
 */
export async function refetchMiniAppContrib(
  source: MiniAppContribSource = defaultSource,
  discoverMiniAppUi: MiniAppUiDiscovery = discoverMiniAppUiLazily,
): Promise<boolean> {
  const request = ++requestVersion
  const startedAt = performance.now()
  inFlightRequests += 1
  try {
    const loaded = await source.loadSnapshot()
    const snapshotAt = performance.now()
    // A newer request started while this one was in flight: its result owns the store.
    // This one counts as a success only when that successor really exists and will
    // publish — a superseded request that returned early without anyone publishing left
    // the tool list (keyed on `version`) stale while the mini app list updated.
    if (request !== requestVersion) return supersededBySuccessor()
    const enabledNames = new Set(
      loaded.miniApps.flatMap((app: MiniAppRecord) => (app.enabled ? [app.name] : [])),
    )
    // `publish` registers the enabled views, which also reconciles removals for
    // any mini app that dropped out (disabled/uninstalled) since the previous sync.
    const firstLoad = snapshot.document === null
    const claim = claimMiniAppUiLoads(loaded.miniApps)
    publish({
      document: loaded,
      views: loaded.views,
      enabledNames,
      miniApps: loaded.miniApps,
      tools: loaded.tools,
      revision: loaded.revision,
    })
    // Each mini app's UI registers as ITS artifact lands; this pass owns settling until the next
    // publish claims (`miniAppUiLoads.ts`). The version moves once, when the last one settles.
    await runMiniAppUiLoads(claim, loaded.miniApps, discoverMiniAppUi, announceMiniAppUiChanged)
    // Names and tools were published at `snapshotMs`; `uiMs` later every artifact had settled.
    if (firstLoad) {
      tauriFrontendLog(
        'mini-apps.ready',
        `snapshotMs=${Math.round(snapshotAt - startedAt)} uiMs=${Math.round(performance.now() - snapshotAt)} miniApps=${loaded.miniApps.length} views=${loaded.views.length}`,
      )
    }
    if (syncFailing) syncProblems((problems) => problems.reportMiniAppSyncRecovery())
    syncFailing = false
    return true
  } catch (error) {
    // A failed request did not establish that zero mini apps are enabled. Preserve
    // `null` (cold start) or the last known-good snapshot and let the retry loop
    // converge once the sidecar is reachable again.
    if (request === requestVersion) {
      syncFailing = true
      syncProblems((problems) => problems.reportMiniAppSyncFailure(error))
    }
    return false
  } finally {
    inFlightRequests -= 1
  }
}

/**
 * Was this superseded request's publication actually handed to a live successor?
 *
 * A superseded request reports SUCCESS so its retry loop stops — correct only when a
 * newer request will publish in its place. But `requestVersion` is also bumped by
 * {@link prepareMiniAppContribScope}, which starts no request of its own, so a scope
 * change landing while the only load was in flight left the bump with no successor:
 * every mini app surface stayed empty, the loop had already declared success, and
 * nothing ever retried. That is the "the API answered 200 once and the workbench
 * shows no mini apps at all" shape, with a healthy server and no error anywhere.
 *
 * Our own request is still counted here, so >1 means somebody else is loading.
 */
function supersededBySuccessor(): boolean {
  return inFlightRequests > 1
}

/**
 * Adopt a snapshot the SERVER just handed us — the answer to a capability toggle —
 * instead of asking for one we already hold.
 *
 * Returns false when the document describes a different scope than this store is
 * converged to (a toggle made from Settings' scope picker, say): the caller keeps it
 * for that scope, and the workbench's own document is refreshed by the server's poke.
 *
 * A toggle used to cost two round trips — the mutation, then a re-read of the very
 * document it invalidated — with a window in between where another client's answer
 * could interleave. This closes both.
 */
export function adoptCapabilitySnapshot(loaded: CapabilitySnapshot): Promise<boolean> {
  if (loaded.scope.projectId !== (activeProjectId ?? '')) return Promise.resolve(false)
  // An out-of-order answer describes a world older than the one already on screen.
  // Two rapid toggles can resolve in either order; revision decides, arrival does not.
  if (snapshot.document && loaded.revision < snapshot.document.revision) {
    return Promise.resolve(true)
  }
  // Same path a fetched snapshot takes: mini app UI discovery, view registration and one
  // publish. Adopting must not be a second way to install state.
  return refetchMiniAppContrib({ loadSnapshot: async () => loaded })
}

/**
 * Converge this singleton after a capability mutation, whatever scope was edited.
 *
 * It used to return early unless the mutated project WAS the active one, on the theory
 * that "inactive projects need no frontend refresh". That theory had a hole: in Settings
 * the scope picker and the workbench's route project are routinely different values, so
 * toggling a mini app from Settings performed no immediate refetch at all and the UI only
 * caught up when the server's debounced `resources.changed` poke arrived ~300ms later — if
 * it arrived. Converging the ACTIVE scope is both correct and cheap: the singleton always
 * describes the workbench's project, so re-reading it after any capability mutation
 * refreshes the surfaces the user is looking at (a global mini app toggled from a project
 * scope participates in every scope anyway) and never publishes another project's set.
 */
export function refetchActiveMiniAppContrib(): Promise<boolean> {
  return currentLoad()
}

/**
 * Start (or restart) the singleton contribution convergence loop. Both initial app
 * bootstrap and `resources.changed` use this path, so a transient failure after a toggle
 * is retried too. Generation-aware cleanup prevents an old React effect cleanup from
 * cancelling a newer event-triggered loop.
 */
export function startMiniAppContribSync(
  load?: () => Promise<boolean>,
  schedule: StartupRetrySchedule = scheduleStartupRetry,
  cancel: StartupRetryCancel = cancelStartupRetry,
): () => void {
  // A bare resync (`resources.changed`, a socket connect) before any route installed its loader
  // would read the GLOBAL scope the route then discards; the route's own start reads after it.
  if (!load && !loaderInstalled) return () => {}
  stopActiveSync?.()
  if (load) {
    currentLoad = load
    loaderInstalled = true
  }
  const generation = ++activeSyncGeneration
  const stop = startStartupRetry(currentLoad, schedule, cancel)
  stopActiveSync = stop

  return () => {
    if (generation !== activeSyncGeneration) return
    stop()
    stopActiveSync = null
  }
}

export function subscribeMiniAppContrib(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Stable snapshot for `useSyncExternalStore` — replaced wholesale on publish. */
export function miniAppContribSnapshot(): MiniAppContribSnapshot {
  return snapshot
}

/**
 * Client staleness key, distinct from the server capability revision. Advances when
 * the revision or enabled set changes, and when a mini app UI change requests a reload.
 * A redundant snapshot still publishes without advancing this key.
 */
export function miniAppContribVersion(): number {
  return version
}

/** The project this store converges to; `undefined` until a route or frame established it. */
export function miniAppContribScope(): string | null | undefined {
  return activeProjectId
}

/** Test seam: forget the loaded state (does not notify). */
export function __resetMiniAppContrib(): void {
  stopActiveSync?.()
  stopActiveSync = null
  __resetThirdPartyViews()
  activeSyncGeneration += 1
  activeProjectId = undefined
  requestVersion += 1
  if (syncFailing) syncProblems((problems) => problems.__resetMiniAppSyncProblems())
  syncFailing = false
  version = 0
  __resetCapabilityVersion()
  loaderInstalled = false
  currentLoad = () => refetchMiniAppContrib()
  inFlightRequests = 0
  snapshot = EMPTY_SNAPSHOT
  __resetMiniAppUiLoads()
  setEnabledMiniAppNames(null)
}
