/**
 * WorkItem body adapters for the Kubernetes tabs: they read the generic `payload`
 * and hand each tab its own typed props. Kept apart from `register.tsx` so that
 * file stays a list of what this provider contributes.
 */
import { lazy } from 'react'

import type { PublishMessageContext, WorkItemLike } from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint } from '@localixai/kit/empty-hint'
import type { KubeNode, KubePod, KubeResourceKind } from '../../backend/contracts'

const KubernetesPodTab = lazy(() =>
  import('../ui/KubernetesPodTab').then((m) => ({ default: m.KubernetesPodTab })),
)

const KubernetesResourceTab = lazy(() =>
  import('../ui/KubernetesResourceTab').then((m) => ({
    default: m.KubernetesResourceTab,
  })),
)

const KubernetesNodeTab = lazy(() =>
  import('../ui/KubernetesNodeTab').then((m) => ({ default: m.KubernetesNodeTab })),
)

/**
 * Adapt the generic WorkItem body props to the pod tab's own props.
 *
 * Both Kubernetes kinds are session kinds — a pod tab's Exec shells into a chat's terminal, and a
 * node/deployment/service tab opens pod tabs — so each acts for the chat the host says it belongs
 * to. Without one there is no terminal and no chat to open into.
 */
export function KubernetesPodBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return <EmptyHint>Open this pod from a chat.</EmptyHint>
  return (
    <KubernetesPodTab
      key={item.id}
      active={visible}
      sessionId={sessionId}
      tabId={item.id}
      podName={(item.payload?.podName as string) ?? item.title}
      namespace={(item.payload?.namespace as string) ?? ''}
      context={item.payload?.context as string | undefined}
      initialPod={item.payload?.pod as KubePod | undefined}
      publishMessageContext={publishMessageContext}
    />
  )
}

/** Adapt the generic WorkItem body props to the node or deployment/service tab. */
export function KubernetesResourceBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return <EmptyHint>Open this resource from a chat.</EmptyHint>
  if (item.payload?.resourceKind === 'node') {
    return (
      <KubernetesNodeTab
        key={item.id}
        active={visible}
        name={(item.payload?.name as string) ?? item.title}
        context={item.payload?.context as string | undefined}
        initialNode={item.payload?.node as KubeNode | undefined}
        publishMessageContext={publishMessageContext}
      />
    )
  }
  return (
    <KubernetesResourceTab
      key={item.id}
      active={visible}
      resourceKind={(item.payload?.resourceKind as KubeResourceKind) ?? 'deployment'}
      name={(item.payload?.name as string) ?? item.title}
      namespace={(item.payload?.namespace as string) ?? ''}
      context={item.payload?.context as string | undefined}
      publishMessageContext={publishMessageContext}
    />
  )
}
