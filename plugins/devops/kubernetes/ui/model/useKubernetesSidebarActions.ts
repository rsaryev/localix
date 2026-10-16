import { useState } from 'react'
import type { KubeDeployment, KubeNode, KubePod } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import type { NodeAction } from '../ui/SidebarRows'
import type { KubernetesWorkbenchModel } from './useKubernetes'
import { toKubeIssue, type KubeIssue } from './kubernetesState'

export interface NodeActionRequest {
  node: KubeNode
  action: NodeAction
}

const podKey = (pod: KubePod) => `${pod.namespace}/${pod.name}`

/** Mutation and confirmation lifecycle for Kubernetes inventory actions. */
export function useKubernetesSidebarActions(kubernetes: KubernetesWorkbenchModel) {
  const [pendingPods, setPendingPods] = useState<Record<string, boolean>>({})
  const [confirmDeletePod, setConfirmDeletePod] = useState<KubePod | null>(null)
  const [confirmRestart, setConfirmRestart] = useState<KubeDeployment | null>(null)
  const [scaleDeployment, setScaleDeployment] = useState<KubeDeployment | null>(null)
  const [portForwardPod, setPortForwardPod] = useState<KubePod | null>(null)
  const [nodeAction, setNodeAction] = useState<NodeActionRequest | null>(null)
  const [actionError, setActionError] = useState<{ title: string; issue: KubeIssue } | null>(null)
  const context = kubernetes.activeContext || undefined

  const deletePod = async (pod: KubePod) => {
    const key = podKey(pod)
    setConfirmDeletePod(null)
    setPendingPods((pending) => ({ ...pending, [key]: true }))
    try {
      await kubernetesApi.deletePod(pod.name, pod.namespace, context)
      await kubernetes.refresh()
    } catch (error) {
      setActionError({ title: `Could not delete ${pod.name}`, issue: toKubeIssue(error) })
    } finally {
      setPendingPods((pending) => ({ ...pending, [key]: false }))
    }
  }

  const restartDeployment = async (deployment: KubeDeployment) => {
    setConfirmRestart(null)
    try {
      await kubernetesApi.restartDeployment(deployment.name, deployment.namespace, context)
      await kubernetes.refresh({ forceSecondary: true, silent: true })
    } catch (error) {
      setActionError({
        title: `Could not restart ${deployment.name}`,
        issue: toKubeIssue(error),
      })
    }
  }

  const runNodeAction = async (request: NodeActionRequest) => {
    setNodeAction(null)
    try {
      if (request.action === 'cordon') {
        await kubernetesApi.cordonNode(request.node.name, context)
      } else if (request.action === 'uncordon') {
        await kubernetesApi.uncordonNode(request.node.name, context)
      } else {
        await kubernetesApi.drainNode(request.node.name, context)
      }
      await kubernetes.refresh({ forceSecondary: true, silent: true })
    } catch (error) {
      setActionError({
        title: `Could not ${request.action} ${request.node.name}`,
        issue: toKubeIssue(error),
      })
    }
  }

  const stopForward = async (id: string) => {
    try {
      await kubernetesApi.stopPortForward(id)
      await kubernetes.refresh({ forceSecondary: true, silent: true })
    } catch (error) {
      setActionError({ title: 'Could not stop port forward', issue: toKubeIssue(error) })
    }
  }

  return {
    context,
    pendingPods,
    confirmDeletePod,
    confirmRestart,
    scaleDeployment,
    portForwardPod,
    nodeAction,
    actionError,
    dismissActionError: () => setActionError(null),
    requestDelete: setConfirmDeletePod,
    cancelDelete: () => setConfirmDeletePod(null),
    deletePod,
    requestRestart: setConfirmRestart,
    cancelRestart: () => setConfirmRestart(null),
    restartDeployment,
    requestScale: setScaleDeployment,
    closeScale: () => setScaleDeployment(null),
    requestPortForward: setPortForwardPod,
    closePortForward: () => setPortForwardPod(null),
    requestNodeAction: (node: KubeNode, action: NodeAction) => setNodeAction({ node, action }),
    cancelNodeAction: () => setNodeAction(null),
    runNodeAction,
    stopForward,
  }
}

export type KubernetesSidebarActions = ReturnType<typeof useKubernetesSidebarActions>
