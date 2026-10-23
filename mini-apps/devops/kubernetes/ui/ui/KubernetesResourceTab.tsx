import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { KubeResourceKind } from '../../backend/contracts'
import { useKubernetesResourceTab } from '../model/useKubernetesResourceTab'
import { KubernetesResourceContent } from './KubernetesResourceContent'
import { KubernetesResourceHeader } from './KubernetesResourceHeader'
import { ScaleDeploymentDialog } from './ScaleDeploymentDialog'

export function KubernetesResourceTab({
  active = true,
  resourceKind,
  name,
  namespace,
  context,
  publishMessageContext,
}: {
  active?: boolean
  resourceKind: KubeResourceKind
  name: string
  namespace: string
  context?: string
  publishMessageContext?: PublishMessageContext
}) {
  const model = useKubernetesResourceTab({
    active,
    resourceKind,
    name,
    namespace,
    context,
    publishMessageContext,
  })
  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full flex-col">
      <KubernetesResourceHeader
        model={model}
        resourceKind={resourceKind}
        name={name}
        namespace={namespace}
        context={context}
      />
      <div className="min-h-0 flex-1">
        <KubernetesResourceContent
          model={model}
          resourceKind={resourceKind}
          name={name}
          namespace={namespace}
          context={context}
        />
      </div>
      <ScaleDeploymentDialog
        deployment={model.scaling ? model.deployment : null}
        context={model.resolvedContext}
        onClose={model.closeScale}
        onScaled={() => {
          void model.refresh()
          void model.loadDeployment()
        }}
      />
    </div>
  )
}
