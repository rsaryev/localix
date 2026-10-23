import { Boxes, Layers, Network, Server, Share2 } from 'lucide-react'
import { ResourceKindBar } from '../../../ui/ResourceKindBar'
import type { K8sResourceView } from '../model/viewState'

export const RESOURCE_META: Record<
  K8sResourceView,
  { label: string; shortLabel: string; icon: typeof Boxes }
> = {
  workloads: { label: 'Workloads', shortLabel: 'Workloads', icon: Layers },
  pods: { label: 'Pods', shortLabel: 'Pods', icon: Boxes },
  deployments: { label: 'Deployments', shortLabel: 'Deploy', icon: Layers },
  services: { label: 'Services', shortLabel: 'Services', icon: Network },
  nodes: { label: 'Nodes', shortLabel: 'Nodes', icon: Server },
  portForwards: { label: 'Port forwards', shortLabel: 'Forwards', icon: Share2 },
}

export const RESOURCE_ORDER = Object.keys(RESOURCE_META) as K8sResourceView[]

export function KubernetesResourceBar({
  value,
  counts,
  errors,
  onChange,
}: {
  value: K8sResourceView
  counts: Record<K8sResourceView, number>
  errors: Partial<Record<K8sResourceView, unknown>>
  onChange: (value: K8sResourceView) => void
}) {
  return (
    <ResourceKindBar
      ariaLabel="Kubernetes resource kinds"
      value={value}
      order={RESOURCE_ORDER}
      meta={RESOURCE_META}
      counts={counts}
      errors={errors}
      onChange={onChange}
    />
  )
}
