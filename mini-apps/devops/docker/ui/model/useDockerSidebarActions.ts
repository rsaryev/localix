import { useState } from 'react'
import { DockerApiError, dockerApi } from '../dockerApi'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'
import { dockerIssue } from './dockerIssue'
import type { DockerWorkbenchModel } from './useDocker'
import type { DockerConfirm } from './confirmCopy'

/** The action's failure, classified sentence and raw text kept apart. */
export const dockerActionIssue = (error: unknown): DevOpsIssue =>
  error instanceof DockerApiError
    ? dockerIssue(error)
    : { message: error instanceof Error ? error.message : 'The container action did not complete.' }

/** Mutations, pending rows, destructive confirmation, and recoverable action errors. */
export function useDockerSidebarActions(docker: DockerWorkbenchModel) {
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<DockerConfirm | null>(null)
  const [actionError, setActionError] = useState<DevOpsIssue | null>(null)

  const setPendingIds = (ids: string[], value: boolean) => {
    setPending((current) => ({
      ...current,
      ...Object.fromEntries(ids.map((id) => [id, value])),
    }))
  }

  const runContainerAction = async (id: string, operation: () => Promise<void>) => {
    setActionError(null)
    setPendingIds([id], true)
    try {
      await operation()
      await docker.refresh()
    } catch (error) {
      setActionError(dockerActionIssue(error))
    } finally {
      setPendingIds([id], false)
      setConfirmRemove(null)
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    const request = confirm
    setConfirm(null)
    setActionError(null)
    try {
      if (request.kind === 'prune') {
        await dockerApi.prune(request.target)
      } else if (request.kind === 'image') {
        await dockerApi.removeImage(request.id, false)
      } else if (request.kind === 'volume') {
        await dockerApi.removeVolume(request.name, false)
      } else if (request.kind === 'network') {
        await dockerApi.removeNetwork(request.id)
      } else if (request.kind === 'compose-up') {
        await dockerApi.composeUp(request.project)
      } else {
        setPendingIds(request.ids, true)
        try {
          const results = await Promise.allSettled(
            request.ids.map((id) => dockerApi.action(id, request.action)),
          )
          await docker.refresh()
          const failures = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          )
          if (failures.length > 0) {
            // Reported here rather than thrown: the count is the sentence, and the first failure's
            // raw text is the detail. Throwing would flatten both into one `Error.message`.
            const first = dockerActionIssue(failures[0]!.reason)
            setActionError({
              message: `${failures.length} of ${request.ids.length} services did not complete.`,
              detail: first.detail ?? first.message,
            })
          }
        } finally {
          setPendingIds(request.ids, false)
        }
        return
      }
      await docker.refresh()
    } catch (error) {
      setActionError(dockerActionIssue(error))
    }
  }

  return {
    pending,
    confirmRemove,
    confirm,
    actionError,
    dismissActionError: () => setActionError(null),
    requestRemove: setConfirmRemove,
    cancelRemove: () => setConfirmRemove(null),
    requestConfirm: setConfirm,
    cancelConfirm: () => setConfirm(null),
    runContainerAction,
    runConfirm,
  }
}

export type DockerSidebarActions = ReturnType<typeof useDockerSidebarActions>
