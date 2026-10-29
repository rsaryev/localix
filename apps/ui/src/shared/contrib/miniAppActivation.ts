import { noteRegistryChange } from './registryChanges'

/**
 * Authoritative enabled set for mini app UI. Core feature
 * contributions have no owner and remain active; mini-app-owned entries fail closed
 * until the API snapshot arrives.
 */
let enabledMiniAppNames: Set<string> | null = null
/**
 * Enabled mini apps whose UI has not registered in this page yet. The enabled set is published the
 * moment the snapshot lands, before any artifact has registered — so an unknown work-item kind may
 * still belong to one of these, and must not read as gone (a restored tab would otherwise be
 * closed as "unavailable" while its mini app loads). `loading` is still being attempted; `failed`
 * ran out of retries for now. Both keep restored tabs: a failed import is a transient 503 while
 * the sidecar restarts as often as it is a broken build, and only the enabled set can say a
 * mini app is really off.
 */
let uiLoadingMiniApps: ReadonlySet<string> = new Set()
let uiFailedMiniApps: ReadonlySet<string> = new Set()
let activationVersion = 0
const listeners = new Set<() => void>()
const notifyListeners = () => listeners.forEach((listener) => listener())

export type MiniAppContributionActivation = 'core' | 'pending' | 'enabled' | 'disabled'

export function setEnabledMiniAppNames(
  names: Set<string> | null,
  uiLoading: ReadonlySet<string> = new Set(),
  uiFailed: ReadonlySet<string> = new Set(),
): void {
  enabledMiniAppNames = names === null ? null : new Set(names)
  uiLoadingMiniApps = new Set(uiLoading)
  uiFailedMiniApps = new Set(uiFailed)
  activationVersion += 1
  notifyListeners()
}

/**
 * A mini app's UI settled (or gave up) without a capability publish. The state is current at once;
 * the broadcast rides the next registry flush, so N mini apps settling in one burst wake every
 * activation subscriber once rather than N times.
 */
export function setMiniAppUiPending(
  loading: ReadonlySet<string>,
  failed: ReadonlySet<string>,
): void {
  uiLoadingMiniApps = new Set(loading)
  uiFailedMiniApps = new Set(failed)
  activationVersion += 1
  noteRegistryChange(notifyListeners)
}

export function miniAppActivationVersion(): number {
  return activationVersion
}

export function subscribeMiniAppActivation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Whether an unknown kind could still belong to an enabled mini app: the enabled set is due, or an
 * enabled mini app's UI has not registered (loading or failed). Anything destructive — closing a
 * restored tab, dropping it from the saved layout — waits for this to be false.
 */
export function areMiniAppContributionsPending(): boolean {
  return enabledMiniAppNames === null || uiLoadingMiniApps.size > 0 || uiFailedMiniApps.size > 0
}

/** Whether a first UI load is still being ATTEMPTED — what "Restoring…" may promise. */
export function areMiniAppUiLoadsInFlight(): boolean {
  return enabledMiniAppNames === null || uiLoadingMiniApps.size > 0
}

/** Tri-state activation is important during cold restore: "not loaded" is not disabled. */
export function miniAppContributionActivation(miniAppName?: string): MiniAppContributionActivation {
  if (miniAppName === undefined) return 'core'
  if (
    enabledMiniAppNames === null ||
    uiLoadingMiniApps.has(miniAppName) ||
    uiFailedMiniApps.has(miniAppName)
  ) {
    return 'pending'
  }
  return enabledMiniAppNames.has(miniAppName) ? 'enabled' : 'disabled'
}

export function isMiniAppContributionEnabled(miniAppName?: string): boolean {
  const activation = miniAppContributionActivation(miniAppName)
  return activation === 'core' || activation === 'enabled'
}
