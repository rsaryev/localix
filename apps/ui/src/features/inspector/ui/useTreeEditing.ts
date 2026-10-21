import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { backendClient } from '@/shared/api/client'
import type { DirEntry } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { acknowledgeInline } from '@/shared/lib/notifications/inlineReport'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import type { FileTreeGuards } from './useDirectoryLoader'
import type { EditState } from './useFileTree'

/* oxlint-disable react-hooks/exhaustive-deps -- refs/setters are stable; preserve the pre-split dependency lists exactly */

type UseTreeEditingOptions = {
  sessionId: string | null
  edit: EditState | null
  guards: FileTreeGuards
  ownsSession: () => boolean
  loadChildren: (path: string) => Promise<boolean>
  reloadDir: (path: string) => Promise<boolean>
  toastUndo: (message: string) => void
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  setEdit: Dispatch<SetStateAction<EditState | null>>
  setEditError: Dispatch<SetStateAction<string | null>>
}

export function useTreeEditing({
  sessionId,
  edit,
  guards,
  ownsSession,
  loadChildren,
  reloadDir,
  toastUndo,
  setExpanded,
  setEdit,
  setEditError,
}: UseTreeEditingOptions) {
  const { treeEpochRef, editIntentRef, editSubmitRef } = guards

  // Begin creating a new file/folder under `parentPath` — expand it first so the
  // inline input is visible, then mount the input as its first child row.
  const startCreate = useCallback(
    async (parentPath: string, kind: 'file' | 'dir') => {
      if (!ownsSession()) return
      const intent = ++editIntentRef.current
      const treeEpoch = treeEpochRef.current
      setEditError(null)
      setExpanded((s) => (s.has(parentPath) ? s : new Set(s).add(parentPath)))
      await loadChildren(parentPath)
      if (!ownsSession() || treeEpochRef.current !== treeEpoch || editIntentRef.current !== intent)
        return
      setEdit({ mode: 'create', parentPath, kind })
    },
    [loadChildren, ownsSession],
  )

  const startRename = useCallback((entry: DirEntry, parentPath: string) => {
    editIntentRef.current += 1
    setEditError(null)
    setEdit({
      mode: 'rename',
      path: `${parentPath}/${entry.name}`,
      parentPath,
      name: entry.name,
      kind: entry.type,
    })
  }, [])

  const cancelEdit = useCallback(() => {
    editIntentRef.current += 1
    setEdit(null)
    setEditError(null)
  }, [])

  const submitEdit = useCallback(
    async (value: string) => {
      if (!sessionId || !edit || !ownsSession()) return
      const intent = editIntentRef.current
      if (editSubmitRef.current === intent) return
      editSubmitRef.current = intent
      try {
        if (edit.mode === 'create') {
          const res = await backendClient.createFileEntry(
            sessionId,
            edit.parentPath,
            value,
            edit.kind,
          )
          await reloadDir(edit.parentPath)
          if (edit.kind === 'file' && ownsSession() && editIntentRef.current === intent)
            openFileInGrid({ sessionId, path: res.path })
        } else {
          await backendClient.renameFileEntry(sessionId, edit.path, value)
          await reloadDir(edit.parentPath)
          // An unchanged name is a server no-op that journals nothing, so it must not take an
          // Undo token either: its row would then reverse whatever came before it.
          if (ownsSession() && value !== edit.name) toastUndo(`Renamed to “${value}”`)
        }
        if (ownsSession() && editIntentRef.current === intent) {
          editIntentRef.current += 1
          setEdit(null)
          setEditError(null)
        }
      } catch (e) {
        if (ownsSession() && editIntentRef.current === intent) {
          // Shown in the field, so the transport's generic row would only repeat it.
          acknowledgeInline(e)
          // Inline field error, the house convention: the server's own sentence ("a file named
          // … already exists") IS the fix here, so it stays. Only the fallback is classified —
          // "Operation failed" named neither the operation nor the entry.
          setEditError(
            errorMessage(
              e,
              edit.mode === 'create'
                ? `Could not create “${value}”.`
                : `Could not rename to “${value}”.`,
            ),
          )
        }
      } finally {
        if (editSubmitRef.current === intent) editSubmitRef.current = null
      }
    },
    [sessionId, edit, ownsSession, reloadDir, toastUndo],
  )

  return { startCreate, startRename, cancelEdit, submitEdit }
}
