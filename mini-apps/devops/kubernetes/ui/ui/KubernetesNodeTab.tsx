import type { KubeNode } from '../../backend/contracts'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useKubernetesNodeTab } from '../model/useKubernetesNodeTab'
import { KubernetesNodeHeader } from './KubernetesNodeHeader'
import { KubernetesNodeOverview } from './KubernetesNodeOverview'
import { KubernetesNodePods } from './KubernetesNodePods'
import { ManifestView } from './ManifestView'

export function KubernetesNodeTab({
  active = true,
  name,
  context,
  initialNode,
  publishMessageContext,
}: {
  active?: boolean
  name: string
  context?: string
  initialNode?: KubeNode
  publishMessageContext?: PublishMessageContext
}) {
  const model = useKubernetesNodeTab({
    active,
    name,
    context,
    initialNode,
    publishMessageContext,
  })
  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <KubernetesNodeHeader model={model} name={name} context={context} />
      <div className="min-h-0 flex-1">
        {model.view === 'manifest' ? (
          <ManifestView kind="node" name={name} namespace="" context={context} />
        ) : model.view === 'pods' ? (
          <KubernetesNodePods model={model} name={name} context={context} />
        ) : (
          <KubernetesNodeOverview model={model} name={name} />
        )}
      </div>
    </div>
  )
}
