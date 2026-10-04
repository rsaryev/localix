import { useState } from 'react'
import { kubernetesApi } from '../api/kubernetesApi'
import { execIntoPod } from './execCommand'
import { toKubeIssue, type KubeIssue } from './kubernetesState'

interface PodTabActionsOptions {
  /** The pod tab's chat — where Exec opens its shell. */
  sessionId: string
  podName: string
  namespace: string
  context?: string
  container: string
  markAbsent: (message: string) => void
  stopForward: (id: string) => Promise<void>
}

/** Mutating pod-tab actions share one busy/confirm/error surface. */
export function usePodTabActions(options: PodTabActionsOptions) {
  const { sessionId, podName, namespace, context, container, markAbsent, stopForward } = options
  const [error, setError] = useState<{ title: string; issue: KubeIssue } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const deletePod = async () => {
    setBusy(true)
    setError(null)
    try {
      await kubernetesApi.deletePod(podName, namespace, context || undefined)
      markAbsent('Pod deleted.')
    } catch (cause) {
      setError({ title: `Could not delete ${podName}`, issue: toKubeIssue(cause) })
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  const exec = async () => {
    setError(null)
    try {
      await execIntoPod({
        sessionId,
        pod: podName,
        namespace,
        context: context || undefined,
        container: container || undefined,
      })
    } catch (cause) {
      setError({ title: `Could not exec into ${podName}`, issue: toKubeIssue(cause) })
    }
  }

  const stop = async (id: string) => {
    setError(null)
    try {
      await stopForward(id)
    } catch (cause) {
      setError({ title: 'Could not stop port forward', issue: toKubeIssue(cause) })
    }
  }

  return {
    error,
    dismissError: () => setError(null),
    busy,
    confirmDelete,
    setConfirmDelete,
    deletePod,
    exec,
    stopForward: stop,
  }
}
