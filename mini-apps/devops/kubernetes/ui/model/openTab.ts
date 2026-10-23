import type { KubeNode, KubePod, KubeResourceKind } from '../../backend/contracts'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { podTabWorkItemId, resourceTabWorkItemId } from './watchPace'

/*
 * Every Kubernetes tab is a SESSION kind, opened in the chat it was asked from (`sessionId`). A pod
 * tab's Exec opens a shell in that chat's terminal, and a node/deployment/service tab opens pod tabs
 * in turn; a tab that belonged to no chat did both in whichever chat happened to be on screen.
 */

/**
 * Open (or focus) a pod's details + describe + logs center tab. This feature owns
 * the `kubernetes-pod` WorkItemKind + its tab-id formula (`podTabWorkItemId`, the
 * single source shared with the tab body + close-cleanup), so re-opening focuses
 * the existing tab. Routed through the generic `miniAppWorkspace.openWorkItem` seam.
 */
export function openKubernetesPodTab(
  sessionId: string,
  podName: string,
  namespace: string,
  context?: string,
  initialPod?: KubePod,
): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'devops:kubernetes-pod',
    id: podTabWorkItemId(context, namespace, podName),
    title: podName,
    scope: sessionId,
    payload: {
      podName,
      namespace,
      context,
      ...(initialPod ? { pod: initialPod } : {}),
    },
  })
}

/** Open (or focus) a deployment/service describe + events tab (sibling of the pod tab). */
export function openKubernetesResourceTab(
  sessionId: string,
  resourceKind: KubeResourceKind,
  name: string,
  namespace: string,
  context?: string,
): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'devops:kubernetes-resource',
    id: resourceTabWorkItemId(resourceKind, context, namespace, name),
    title: name,
    scope: sessionId,
    payload: { resourceKind, name, namespace, context },
  })
}

/** Open or focus a cluster-scoped node detail using the existing resource work-item kind. */
export function openKubernetesNodeTab(sessionId: string, node: KubeNode, context?: string): void {
  openKubernetesNodeTabByName(sessionId, node.name, context, node)
}

/** Open a node relation when only its name is known; the detail tab resolves it live. */
export function openKubernetesNodeTabByName(
  sessionId: string,
  name: string,
  context?: string,
  initialNode?: KubeNode,
): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'devops:kubernetes-resource',
    id: `devops:kubernetes-node:${encodeURIComponent(context || 'current')}:${encodeURIComponent(name)}`,
    title: name,
    scope: sessionId,
    payload: {
      resourceKind: 'node',
      name,
      namespace: '',
      context,
      ...(initialNode ? { node: initialNode } : {}),
    },
  })
}
