import type { DockerResourceDetail } from './model/dockerResourceDetail'
import { useDockerResourceDetail } from './model/useDockerResourceDetail'
import { DockerResourceContent } from './ui/DockerResourceContent'
import { DockerResourceHeader } from './ui/DockerResourceHeader'

export function DockerResourceTab({
  active = true,
  kind,
  identity,
  initial,
  fallbackLabel,
}: {
  active?: boolean
  kind: DockerResourceDetail['kind']
  identity: string
  initial?: DockerResourceDetail
  fallbackLabel: string
}) {
  const model = useDockerResourceDetail({
    active,
    kind,
    identity,
    initial,
    fallbackLabel,
  })

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <DockerResourceHeader kind={kind} model={model} />
      <DockerResourceContent model={model} />
    </div>
  )
}
