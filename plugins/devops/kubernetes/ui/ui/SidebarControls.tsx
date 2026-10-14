import type { ReactNode } from 'react'
import { ALL_NAMESPACES, type KubeContext, type KubeNamespace } from '../../backend/contracts'
import { Combobox } from '@localixai/kit/combobox'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchFilterBar } from '@localixai/kit/workbench-filter-bar'
import { ResourceSortControl, type ResourceSortOption } from '../../../ui/ResourceSortControl'
import type { ResourceSort } from '../../../ui/model/resourceSort'
import type { K8sSortKey } from '../model/viewState'

/** Workspace scope controls: context, namespace, and the selected resource filter. */
export function SidebarControls({
  contexts,
  currentContext,
  activeContext,
  setActiveContext,
  namespaces,
  activeNamespace,
  setActiveNamespace,
  filter,
  setFilter,
  resourceLabel,
  sort,
  sortOptions,
  setSort,
  actions,
}: {
  contexts: KubeContext[]
  currentContext: string
  activeContext: string
  setActiveContext: (context: string) => void
  namespaces: KubeNamespace[]
  activeNamespace: string
  setActiveNamespace: (namespace: string) => void
  filter: string
  setFilter: (next: string) => void
  resourceLabel: string
  sort: ResourceSort<K8sSortKey>
  sortOptions: readonly ResourceSortOption<K8sSortKey>[]
  setSort: (sort: ResourceSort<K8sSortKey>) => void
  actions?: ReactNode
}) {
  return (
    <WorkbenchFilterBar aria-label="Kubernetes filters" columns={4}>
      <div className="min-w-0">
        <span className="mb-1 block text-2xs text-text-faint">Context</span>
        <Combobox
          aria-label="Context"
          size="md"
          className="w-full"
          value={activeContext}
          onValueChange={setActiveContext}
          placeholder="Select…"
          searchPlaceholder="Search contexts…"
          emptyLabel="No matching contexts"
          options={contexts.map((c) => ({
            value: c.name,
            label: c.name,
            // Flag the cluster's current-context (from kubeconfig) so switching
            // away from it is obvious. Derived from data already in the hook.
            hint: c.name === currentContext ? 'current' : undefined,
          }))}
        />
      </div>
      <div className="min-w-0">
        <span className="mb-1 block text-2xs text-text-faint">Namespace</span>
        <Combobox
          aria-label="Namespace"
          size="md"
          className="w-full"
          value={activeNamespace}
          onValueChange={setActiveNamespace}
          disabled={namespaces.length === 0}
          placeholder={namespaces.length ? 'Select…' : 'None'}
          searchPlaceholder="Search namespaces…"
          emptyLabel="No matching namespaces"
          menuHeader={
            namespaces.length
              ? `${namespaces.length} namespace${namespaces.length === 1 ? '' : 's'}`
              : undefined
          }
          options={[
            { value: ALL_NAMESPACES, label: 'All namespaces', hint: 'cluster' },
            ...namespaces.map((n) => ({
              value: n.name,
              label: n.name,
              hint: n.phase !== 'Active' ? n.phase : undefined,
            })),
          ]}
        />
      </div>
      <SearchInput
        value={filter}
        onValueChange={setFilter}
        placeholder={`Search ${resourceLabel.toLowerCase()}…`}
        tone="default"
        size="md"
        className="w-full"
      />
      <div className="flex min-w-0 items-center justify-end gap-1 self-end @lg:justify-self-end">
        <ResourceSortControl<K8sSortKey> sort={sort} options={sortOptions} onChange={setSort} />
        {actions}
      </div>
    </WorkbenchFilterBar>
  )
}
