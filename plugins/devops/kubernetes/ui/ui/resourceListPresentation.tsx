import { EmptyHint } from '@localixai/kit/empty-hint'
import type { K8sResourceView } from '../model/viewState'
import { RESOURCE_META } from './KubernetesResourceBar'

export function matchesResourceQuery(query: string, ...values: string[]): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || values.some((value) => value.toLowerCase().includes(needle))
}

export function EmptyResource({
  resource,
  filtered,
}: {
  resource: K8sResourceView
  filtered: boolean
}) {
  const label = RESOURCE_META[resource].label.toLowerCase()
  return (
    <EmptyHint className="p-4">
      {filtered ? `No matching ${label}.` : `No ${label} here.`}
    </EmptyHint>
  )
}
