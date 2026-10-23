import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useDockerContainerTab } from './model/useDockerContainerTab'
import { DockerContainerContent } from './ui/DockerContainerContent'
import { DockerContainerHeader } from './ui/DockerContainerHeader'

/** Live Docker container detail with target-scoped data and panel-aware polling. */
export function DockerContainerTab({
  sessionId,
  active = true,
  containerId,
  name,
  publishMessageContext,
}: {
  /** The chat this tab belongs to (its work item's session), never the one on screen. */
  sessionId: string
  active?: boolean
  containerId: string
  name: string
  publishMessageContext?: PublishMessageContext
}) {
  const model = useDockerContainerTab({
    active,
    containerId,
    name,
    publishMessageContext,
  })
  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full flex-col">
      <DockerContainerHeader
        sessionId={sessionId}
        model={model}
        containerId={containerId}
        fallbackName={name}
      />
      <DockerContainerContent model={model} fallbackName={name} />
    </div>
  )
}
