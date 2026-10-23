import { useCallback } from 'react'
import { toast } from '@/shared/lib/notify'
import { backendClient } from '@/shared/api/client'
import { inspector } from '@/shared/lib/inspectorBus'
import { baseName, errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { composeOnSaveContent, getSaveCleanupPrefs } from '@/shared/ui/code-editor/saveCleanup'
import { reloadGuard } from '../lib/reloadGuard'
import { fileEditorOwnerKey } from '../model/fileDrafts'
import { buildCompareDiff } from '../lib/compare-diff'
import type { FileConflict, FileEditorWriteState } from './fileEditorContracts'
import { adoptWrittenFile, trackFileSaveTask } from './fileSaveTask'

interface FileConflictActionsOptions extends FileEditorWriteState {
  sessionId: string | null
  path: string
  buffer: string
  editPath: string
  conflict: FileConflict | null
  adoptDisk: (content: string, hash: string) => void
}

export function useFileConflictActions({
  sessionId,
  path,
  buffer,
  editPath,
  conflict,
  adoptDisk,
  bufferRef,
  baseContentRef,
  baseHashRef,
  lastSyncedRef,
  savingRef,
  savePromiseRef,
  setSaving,
  setEditError,
  setBaseHash,
  setBaseContent,
  setBuffer,
  setConflict,
}: FileConflictActionsOptions) {
  // Overwrite the on-disk version with the current buffer, echoing the fresh disk
  // hash so the concurrency check passes (deliberate clobber, user-confirmed).
  const overwrite = useCallback((): Promise<boolean> => {
    const c = conflict
    if (!sessionId || !c) return Promise.resolve(false)
    const savedBuffer = buffer
    const task = (async (): Promise<boolean> => {
      setSaving(true)
      savingRef.current = true
      if (editPath) reloadGuard.markSaving(fileEditorOwnerKey(sessionId, editPath))
      try {
        const composed = composeOnSaveContent(savedBuffer, null, getSaveCleanupPrefs())
        const written = await backendClient.writeFileContent(sessionId, path, composed, c.diskHash)
        adoptWrittenFile(
          {
            bufferRef,
            baseContentRef,
            baseHashRef,
            lastSyncedRef,
            setBaseHash,
            setBaseContent,
            setBuffer,
            setConflict,
          },
          { sessionId, path, editPath, savedBuffer, composed, written },
        )
        setEditError(null)
        // No success row: the reconcile banner closes and the tab turns clean where it was clicked.
        return true
      } catch (err) {
        toast.error(`Could not overwrite “${baseName(path)}” on disk`, {
          description: errorMessage(err, '') || undefined,
        })
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    })()
    return trackFileSaveTask(savePromiseRef, savedBuffer, task)
  }, [
    sessionId,
    path,
    buffer,
    conflict,
    editPath,
    bufferRef,
    baseContentRef,
    baseHashRef,
    lastSyncedRef,
    savingRef,
    savePromiseRef,
    setSaving,
    setEditError,
    setBaseHash,
    setBaseContent,
    setBuffer,
    setConflict,
  ])

  // Discard local edits and take the on-disk version (from the captured conflict, or
  // a fresh read when invoked without one).
  const reloadFromDisk = useCallback(async () => {
    if (conflict) {
      adoptDisk(conflict.diskContent, conflict.diskHash)
      return
    }
    if (!sessionId) return
    try {
      const cur = await backendClient.getFileContent(sessionId, path, { full: true })
      if (cur.hash != null) adoptDisk(cur.content, cur.hash)
    } catch (err) {
      toast.error(`Could not re-read “${baseName(path)}” from disk`, {
        description: errorMessage(err, '') || undefined,
      })
    }
  }, [sessionId, path, conflict, adoptDisk])

  // Open a two-file compare tab: your unsaved buffer (right) vs the on-disk version
  // (left), so you can eyeball exactly what would be lost before choosing. The tab
  // carries the (plain-data) apply context so it can resolve the conflict in place
  // via its own header actions — no need to return here to the banner.
  const compareWithDisk = useCallback(() => {
    if (!conflict || !editPath || !sessionId) return
    const name = baseName(editPath)
    const diff = buildCompareDiff(editPath, editPath, conflict.diskContent, buffer)
    inspector.openDiff({
      sessionId,
      path: `conflict://${editPath}`,
      diff,
      title: `${name} (on disk ↔ your edits)`,
      languagePath: editPath,
      conflict: {
        sessionId,
        editPath,
        edits: buffer,
        diskContent: conflict.diskContent,
        diskHash: conflict.diskHash,
      },
    })
  }, [conflict, editPath, buffer, sessionId])

  return { overwrite, reloadFromDisk, compareWithDisk }
}
