import { noteRegistryChange } from './registryChanges'

/**
 * Authoritative enabled set for statically imported bundled plugin UI. Core feature
 * contributions have no owner and remain active; plugin-owned entries fail closed
 * until the API snapshot arrives.
 */
let enabledPluginNames: Set<string> | null = null
/**
 * Enabled plugins whose UI has not registered in this page yet. The enabled set is published the
 * moment the snapshot lands, before any artifact has registered — so an unknown work-item kind may
 * still belong to one of these, and must not read as gone (a restored tab would otherwise be
 * closed as "unavailable" while its plugin loads). `loading` is still being attempted; `failed`
 * ran out of retries for now. Both keep restored tabs: a failed import is a transient 503 while
 * the sidecar restarts as often as it is a broken build, and only the enabled set can say a
 * plugin is really off.
 */
let uiLoadingPlugins: ReadonlySet<string> = new Set()
let uiFailedPlugins: ReadonlySet<string> = new Set()
let activationVersion = 0
const listeners = new Set<() => void>()
const notifyListeners = () => listeners.forEach((listener) => listener())

export type PluginContributionActivation = 'core' | 'pending' | 'enabled' | 'disabled'

export function setEnabledPluginNames(
  names: Set<string> | null,
  uiLoading: ReadonlySet<string> = new Set(),
  uiFailed: ReadonlySet<string> = new Set(),
): void {
  enabledPluginNames = names === null ? null : new Set(names)
  uiLoadingPlugins = new Set(uiLoading)
  uiFailedPlugins = new Set(uiFailed)
  activationVersion += 1
  notifyListeners()
}

/**
 * A plugin's UI settled (or gave up) without a capability publish. The state is current at once;
 * the broadcast rides the next registry flush, so N plugins settling in one burst wake every
 * activation subscriber once rather than N times.
 */
export function setPluginUiPending(
  loading: ReadonlySet<string>,
  failed: ReadonlySet<string>,
): void {
  uiLoadingPlugins = new Set(loading)
  uiFailedPlugins = new Set(failed)
  activationVersion += 1
  noteRegistryChange(notifyListeners)
}

export function pluginActivationVersion(): number {
  return activationVersion
}

export function subscribePluginActivation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Whether an unknown kind could still belong to an enabled plugin: the enabled set is due, or an
 * enabled plugin's UI has not registered (loading or failed). Anything destructive — closing a
 * restored tab, dropping it from the saved layout — waits for this to be false.
 */
export function arePluginContributionsPending(): boolean {
  return enabledPluginNames === null || uiLoadingPlugins.size > 0 || uiFailedPlugins.size > 0
}

/** Whether a first UI load is still being ATTEMPTED — what "Restoring…" may promise. */
export function arePluginUiLoadsInFlight(): boolean {
  return enabledPluginNames === null || uiLoadingPlugins.size > 0
}

/** Tri-state activation is important during cold restore: "not loaded" is not disabled. */
export function pluginContributionActivation(pluginName?: string): PluginContributionActivation {
  if (pluginName === undefined) return 'core'
  if (
    enabledPluginNames === null ||
    uiLoadingPlugins.has(pluginName) ||
    uiFailedPlugins.has(pluginName)
  ) {
    return 'pending'
  }
  return enabledPluginNames.has(pluginName) ? 'enabled' : 'disabled'
}

export function isPluginContributionEnabled(pluginName?: string): boolean {
  const activation = pluginContributionActivation(pluginName)
  return activation === 'core' || activation === 'enabled'
}
