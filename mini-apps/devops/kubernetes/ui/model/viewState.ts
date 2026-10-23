// Persisted sidebar VIEW preferences — the selected resource kind and filter. Stored under a
// DEDICATED record (`localix.k8s.view`), separate from the context/namespace
// SELECTION record (`localix.k8s.selection`, owned by `useKubernetes.ts`) so the
// two concerns persist independently. The normalize/read helpers are pure and
// unit-tested (`kubernetesView.test.ts`).
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { normalizeResourceSort, type ResourceSort } from '../../../ui/model/resourceSort'

const K8S_VIEW_KEY = 'localix.k8s.view'

export type K8sResourceView =
  | 'workloads'
  | 'pods'
  | 'deployments'
  | 'services'
  | 'nodes'
  | 'portForwards'
export type K8sSortKey =
  | 'name'
  | 'status'
  | 'namespace'
  | 'restarts'
  | 'created'
  | 'ready'
  | 'type'
  | 'role'
  | 'port'
export type K8sSortState = Record<K8sResourceView, ResourceSort<K8sSortKey>>

export const K8S_SORT_OPTIONS = {
  workloads: [
    { value: 'name', label: 'Name' },
    { value: 'status', label: 'Health' },
    { value: 'namespace', label: 'Namespace' },
    { value: 'created', label: 'Created' },
  ],
  pods: [
    { value: 'status', label: 'Health' },
    { value: 'name', label: 'Name' },
    { value: 'namespace', label: 'Namespace' },
    { value: 'restarts', label: 'Restarts' },
    { value: 'created', label: 'Created' },
  ],
  deployments: [
    { value: 'name', label: 'Name' },
    { value: 'ready', label: 'Readiness' },
    { value: 'namespace', label: 'Namespace' },
    { value: 'created', label: 'Created' },
  ],
  services: [
    { value: 'name', label: 'Name' },
    { value: 'type', label: 'Type' },
    { value: 'namespace', label: 'Namespace' },
    { value: 'created', label: 'Created' },
  ],
  nodes: [
    { value: 'status', label: 'Status' },
    { value: 'name', label: 'Name' },
    { value: 'role', label: 'Role' },
    { value: 'created', label: 'Created' },
  ],
  portForwards: [
    { value: 'name', label: 'Pod' },
    { value: 'namespace', label: 'Namespace' },
    { value: 'port', label: 'Local port' },
    { value: 'created', label: 'Created' },
  ],
} as const satisfies Record<K8sResourceView, readonly { value: K8sSortKey; label: string }[]>

const DEFAULT_K8S_SORT = {
  workloads: { key: 'name', direction: 'asc' },
  pods: { key: 'status', direction: 'asc' },
  deployments: { key: 'name', direction: 'asc' },
  services: { key: 'name', direction: 'asc' },
  nodes: { key: 'status', direction: 'asc' },
  portForwards: { key: 'name', direction: 'asc' },
} as const satisfies K8sSortState

export interface K8sViewState {
  filter: string
  resource: K8sResourceView
  sort: K8sSortState
}

const RESOURCES = new Set<K8sResourceView>([
  'workloads',
  'pods',
  'deployments',
  'services',
  'nodes',
  'portForwards',
])

/** Normalize an untrusted persisted value into a valid view record — tolerates a
 *  missing/corrupt payload. Old collapsible-section records migrate to Workloads. */
export function normalizeK8sView(raw: unknown): K8sViewState {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const storedSort =
    rec.sort && typeof rec.sort === 'object' ? (rec.sort as Record<string, unknown>) : {}
  const filter = typeof rec.filter === 'string' ? rec.filter : ''
  const resource =
    typeof rec.resource === 'string' && RESOURCES.has(rec.resource as K8sResourceView)
      ? (rec.resource as K8sResourceView)
      : 'workloads'
  return {
    filter,
    resource,
    sort: {
      workloads: normalizeResourceSort(
        storedSort.workloads,
        K8S_SORT_OPTIONS.workloads.map((option) => option.value),
        DEFAULT_K8S_SORT.workloads,
      ),
      pods: normalizeResourceSort(
        storedSort.pods,
        K8S_SORT_OPTIONS.pods.map((option) => option.value),
        DEFAULT_K8S_SORT.pods,
      ),
      deployments: normalizeResourceSort(
        storedSort.deployments,
        K8S_SORT_OPTIONS.deployments.map((option) => option.value),
        DEFAULT_K8S_SORT.deployments,
      ),
      services: normalizeResourceSort(
        storedSort.services,
        K8S_SORT_OPTIONS.services.map((option) => option.value),
        DEFAULT_K8S_SORT.services,
      ),
      nodes: normalizeResourceSort(
        storedSort.nodes,
        K8S_SORT_OPTIONS.nodes.map((option) => option.value),
        DEFAULT_K8S_SORT.nodes,
      ),
      portForwards: normalizeResourceSort(
        storedSort.portForwards,
        K8S_SORT_OPTIONS.portForwards.map((option) => option.value),
        DEFAULT_K8S_SORT.portForwards,
      ),
    },
  }
}

export function loadK8sView(): K8sViewState {
  return normalizeK8sView(loadJSON<unknown>(K8S_VIEW_KEY))
}

export function saveK8sView(view: K8sViewState): void {
  saveJSON(K8S_VIEW_KEY, view)
}
