/**
 * WorkItem body adapters for the Docker tabs: they read the generic `payload` and
 * hand each tab its own typed props. Kept apart from `register.tsx` so that file
 * stays a list of what this provider contributes.
 */
import { lazy } from 'react'

import type { PublishMessageContext, WorkItemLike } from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint } from '@localixai/kit/empty-hint'
import type { DockerImage, DockerNetwork, DockerVolume } from '../../backend/contracts'

const DockerContainerTab = lazy(() =>
  import('../DockerContainerTab').then((m) => ({ default: m.DockerContainerTab })),
)

export const DockerManifestTab = lazy(() =>
  import('../DockerManifestTab').then((m) => ({ default: m.DockerManifestTab })),
)

const DockerResourceTab = lazy(() =>
  import('../DockerResourceTab').then((m) => ({ default: m.DockerResourceTab })),
)

/**
 * Adapt the generic WorkItem body props to the tab's own props (reads `payload`).
 *
 * The container tab is a session kind — its Exec opens a shell in a chat's terminal — so it acts
 * for the chat the host says it belongs to. Without one there is no terminal to open into.
 */
export function DockerContainerBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return <EmptyHint>Open this container from a chat.</EmptyHint>
  return (
    <DockerContainerTab
      key={item.id}
      active={visible}
      sessionId={sessionId}
      containerId={(item.payload?.containerId as string) ?? ''}
      name={(item.payload?.name as string) ?? item.title}
      publishMessageContext={publishMessageContext}
    />
  )
}

/** The resource kinds a Docker resource tab can render, and the row each carries. */
type ResourceInitial =
  | { kind: 'image'; resource: DockerImage }
  | { kind: 'volume'; resource: DockerVolume }
  | { kind: 'network'; resource: DockerNetwork }

function isResourceKind(value: unknown): value is ResourceInitial['kind'] {
  return value === 'image' || value === 'volume' || value === 'network'
}

export function DockerResourceBody({ item, visible }: { item: WorkItemLike; visible: boolean }) {
  const kind = item.payload?.resourceKind
  const resource = item.payload?.resource
  const identity = item.payload?.resourceIdentity
  const uri = item.payload?.uri
  if (typeof uri !== 'string' || typeof identity !== 'string' || !isResourceKind(kind)) return null
  // One branch for all three kinds: they differ only in the row type, which is a
  // compile-time distinction the tab re-narrows from `kind` anyway.
  const initial =
    resource && typeof resource === 'object' ? ({ kind, resource } as ResourceInitial) : undefined
  return (
    <DockerResourceTab
      active={visible}
      kind={kind}
      identity={identity}
      initial={initial}
      fallbackLabel={item.title}
    />
  )
}
