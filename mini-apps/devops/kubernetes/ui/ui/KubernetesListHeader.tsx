import { ResourceListHeader } from '../../../ui/ResourceListHeader'

/** Shared inventory columns. The action cell remains present so switching resource
 * kinds never moves the metadata columns horizontally. */
export const KUBERNETES_RESOURCE_GRID =
  'grid grid-cols-[minmax(0,1fr)_7rem_4.75rem] items-center gap-2 @md:grid-cols-[minmax(0,1fr)_11rem_4.75rem]'

/** Sticky column legend for the full-width Kubernetes inventory. */
export function KubernetesListHeader({
  primary,
  secondary,
}: {
  primary: string
  secondary: string
}) {
  return (
    <ResourceListHeader gridClassName={KUBERNETES_RESOURCE_GRID}>
      <span className="min-w-0 truncate">{primary}</span>
      <span className="truncate text-right">{secondary}</span>
      <span className="text-right">Actions</span>
    </ResourceListHeader>
  )
}
