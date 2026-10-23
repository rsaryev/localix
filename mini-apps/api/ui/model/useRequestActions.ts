/**
 * The navigator's collection mutations: create a request or folder, delete, and the row actions
 * (duplicate, rename, move) — each reporting a failure once above the list.
 */

import { useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { RequestInfo } from '../../backend/contracts'
import { restApi } from '../restApi'

export function useRequestActions({
  sessionId,
  requests,
  activeName,
  onSelect,
  refresh,
  onFolderCreated,
}: {
  sessionId: string
  requests: RequestInfo[]
  activeName?: string
  onSelect: (name?: string) => void
  refresh: () => Promise<unknown>
  /** A new folder is only visible in the folder view, so creating one switches to it. */
  onFolderCreated: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  // A failed create/manage action is shown once above the list, replaced by the next action.
  const [actionError, setActionError] = useState<string | null>(null)
  const [folderParent, setFolderParent] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')

  // Mint a blank request under the first free `new-request[-N]` name and select it immediately;
  // naming and other edits happen in the request pane rather than an extra form.
  const createNew = (folder = '') => {
    if (creating) return
    setCreating(true)
    setActionError(null)
    const taken = new Set(requests.map((r) => r.name))
    const prefix = folder === '' ? '' : `${folder}/`
    let name = `${prefix}new-request`
    for (let n = 2; taken.has(name); n++) name = `${prefix}new-request-${n}`
    void restApi
      .create(sessionId, { name, method: 'GET', url: '' })
      .then((res) => {
        onSelect(res.request.name)
        return refresh()
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'Could not create the request.')
      })
      .finally(() => {
        setCreating(false)
      })
  }

  const createFolder = () => {
    if (folderParent === null || creating) return
    const leaf = folderName.trim().replace(/^\/+|\/+$/g, '')
    if (!leaf) return
    const name = folderParent ? `${folderParent}/${leaf}` : leaf
    setCreating(true)
    setActionError(null)
    void restApi
      .createFolder(sessionId, name)
      .then(async () => {
        onFolderCreated()
        await refresh()
        setFolderParent(null)
        setFolderName('')
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'Could not create the folder.')
      })
      .finally(() => setCreating(false))
  }

  const removeFolder = (name: string) => {
    setActionError(null)
    void restApi
      .removeFolder(sessionId, name)
      .then(() => refresh())
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'Could not delete the folder.')
      })
  }

  const remove = async (name: string) => {
    setPending((p) => ({ ...p, [name]: true }))
    setActionError(null)
    try {
      await restApi.remove(sessionId, name)
      if (name === activeName) onSelect(undefined)
      await refresh()
    } catch (err) {
      acknowledgeInline(err)
      setActionError(err instanceof Error ? err.message : 'Could not delete the request.')
    } finally {
      setPending((p) => ({ ...p, [name]: false }))
      setConfirmDelete(null)
    }
  }

  // A failed manage action (rename to a taken name, duplicate of a just-deleted row) is shown
  // once above the list, replaced by the next action — not trapped in a dialog.
  const manage = (name: string, action: () => Promise<unknown>) => {
    setPending((p) => ({ ...p, [name]: true }))
    setActionError(null)
    void action()
      .then(() => refresh())
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'The action failed.')
      })
      .finally(() => {
        setPending((p) => ({ ...p, [name]: false }))
      })
  }

  return {
    creating,
    confirmDelete,
    setConfirmDelete,
    pending,
    actionError,
    folderParent,
    setFolderParent,
    folderName,
    setFolderName,
    createNew,
    createFolder,
    removeFolder,
    remove,
    manage,
  }
}
