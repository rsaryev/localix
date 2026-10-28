import { ALL_NAMESPACES, type KubeContext, type KubeNamespace } from '../../backend/contracts'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

/**
 * Persisted context+namespace selection (survives reload + rail switch).
 *
 * Shape choice: we keep the last-selected `context` PLUS a per-context
 * `namespaceByContext` map, rather than a single flat `{context, namespace}`.
 * A remembered namespace *per context* is the nicer UX — switching back to a
 * context restores the namespace you last looked at there, instead of resetting
 * to `default`. All reads are validated against the freshly-fetched cluster
 * lists, because a stored context/namespace may have since been deleted.
 */
export interface K8sSelection {
  context: string
  namespaceByContext: Record<string, string>
}

const SELECTION_KEY = 'localix.k8s.selection'

/** Read the persisted selection, dropping anything malformed. */
export function loadK8sSelection(): K8sSelection {
  const stored = loadJSON<Partial<K8sSelection>>(SELECTION_KEY)
  const namespaceByContext =
    stored?.namespaceByContext && typeof stored.namespaceByContext === 'object'
      ? (stored.namespaceByContext as Record<string, string>)
      : {}
  return {
    context: typeof stored?.context === 'string' ? stored.context : '',
    namespaceByContext,
  }
}

/** Persist the selection back to localStorage. */
export function saveK8sSelection(selection: K8sSelection): void {
  saveJSON(SELECTION_KEY, selection)
}

/**
 * Choose the initial context: the STORED one if it still exists in the fetched list,
 * else the kubeconfig current-context, else the first context. Pure so the
 * "stored value may be stale" decision is unit-tested.
 */
export function resolveInitialContext(
  storedContext: string | undefined,
  contexts: KubeContext[],
  current: string,
): string {
  if (storedContext && contexts.some((c) => c.name === storedContext)) return storedContext
  return current || contexts[0]?.name || ''
}

/**
 * Choose the active namespace for a context: the STORED one if it still exists in the
 * loaded list, else keep the currently-selected one if it's still present, else fall
 * back to `default` or the first namespace. Pure + unit-tested.
 */
export function resolveActiveNamespace(
  storedNamespace: string | undefined,
  currentNamespace: string,
  namespaces: KubeNamespace[],
): string {
  if (storedNamespace === ALL_NAMESPACES) return ALL_NAMESPACES
  if (storedNamespace && namespaces.some((n) => n.name === storedNamespace)) return storedNamespace
  if (currentNamespace && namespaces.some((n) => n.name === currentNamespace))
    return currentNamespace
  return namespaces.some((n) => n.name === 'default') ? 'default' : (namespaces[0]?.name ?? '')
}
