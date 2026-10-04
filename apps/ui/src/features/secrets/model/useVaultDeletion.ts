import { useState } from 'react'

import type { SecretBinding, SecretMeta } from '@localixai/api/client'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import { ApiError } from '@/shared/api/internal'
import { secretsApi } from '@/shared/api/secretsApi'
import { vaultFailure } from './vaultProblem'

/**
 * THE DELETE CONFIRMATION — its own state machine, and deliberately NOT part of the Vault's
 * standing problem report.
 *
 * A delete failure belongs on the dialog that caused it: the person is looking at the modal,
 * and the thing that failed is the thing they just pressed. So `deleteError` is local here and
 * rendered by `VaultDeleteDialog`, while `useVaultWorkspace` keeps sole ownership of the row the
 * Event Center holds for the LIST. Two publishers of one subject settle each other's rows, which
 * is exactly what would happen if this flow reported through the workspace's report as well.
 *
 * The one non-obvious step: a refused delete carrying `vault_item_in_use` re-fetches the
 * consumers, because the reason the delete was refused is the list the dialog now has to show.
 */
export function useVaultDeletion(refresh: (quiet?: boolean) => Promise<void>) {
  const [deleteTarget, setDeleteTarget] = useState<SecretMeta | undefined>()
  const [deleteBindings, setDeleteBindings] = useState<SecretBinding[]>([])
  const [loadingDeleteBindings, setLoadingDeleteBindings] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<Problem | null>(null)

  const beginDelete = async (item: SecretMeta) => {
    setDeleteTarget(item)
    setDeleteBindings([])
    setDeleteError(null)
    setLoadingDeleteBindings(true)
    try {
      setDeleteBindings(await secretsApi.bindings(item.key))
    } catch (caught) {
      setDeleteError(vaultFailure(caught, 'The list of consumers could not be checked.'))
    } finally {
      setLoadingDeleteBindings(false)
    }
  }

  const confirmDelete = async (force: boolean) => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await secretsApi.remove(deleteTarget.key, {
        expectedVersion: deleteTarget.version,
        force,
      })
      setDeleteTarget(undefined)
      await refresh(true)
    } catch (caught) {
      setDeleteError(vaultFailure(caught, 'This Vault item could not be deleted.'))
      if (caught instanceof ApiError && caught.code === 'vault_item_in_use') {
        setDeleteBindings(await secretsApi.bindings(deleteTarget.key).catch(() => []))
      }
    } finally {
      setDeleting(false)
    }
  }

  return {
    beginDelete,
    confirmDelete,
    deleteBindings,
    deleteError,
    deleteTarget,
    deleting,
    loadingDeleteBindings,
    setDeleteTarget,
  }
}
