import { useCallback, type RefObject } from 'react'
import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { baseName, errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { composeOnSaveContent, getSaveCleanupPrefs } from '@/shared/ui/code-editor/saveCleanup'
import { reloadGuard } from '../lib/reloadGuard'
import { fileEditorOwnerKey } from '../model/fileDrafts'
import { fileContentCache } from '../model/fileContentCache'
import type { FileEditorWriteState, FormatOnSaveRunner } from './fileEditorContracts'
import { adoptWrittenFile, trackFileSaveTask } from './fileSaveTask'

interface FileEditorSaveOptions extends FileEditorWriteState {
  sessionId: string | null
  path: string
  buffer: string
  editPath: string
  formatOnSaveRef?: RefObject<FormatOnSaveRunner | null>
  workItemVisibleRef: RefObject<boolean>
}

export function useFileEditorSave({
  sessionId,
  path,
  buffer,
  editPath,
  formatOnSaveRef,
  workItemVisibleRef,
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
}: FileEditorSaveOptions) {
  const save = useCallback((): Promise<boolean> => {
    if (!sessionId) return Promise.resolve(false)
    // Cmd+S, auto-save and comment/fix preflight can converge on the same render.
    // Join a write of the same snapshot, or queue the newer snapshot after it,
    // instead of issuing two writes with the same base hash (the second would
    // falsely look like an external conflict).
    const activeSave = savePromiseRef.current
    if (activeSave) {
      if (activeSave.content === buffer) return activeSave.task
      return activeSave.task.then((saved) => (saved ? save() : false))
    }

    const savedBuffer = buffer
    const savedBaseHash = baseHashRef.current
    const task = (async (): Promise<boolean> => {
      setSaving(true)
      savingRef.current = true
      setEditError(null)
      // Open the save-settle window BEFORE the write so the fs-change our own save
      // triggers is dropped instead of racing the not-yet-committed base hash.
      if (editPath) reloadGuard.markSaving(fileEditorOwnerKey(sessionId, editPath))
      try {
        // Format-on-save formats the BUFFER, in memory, before the one write: the formatter
        // answers with edits for the text the language server holds, so that text is made
        // the snapshot being saved first (a hidden tab's document was closed — reopen it;
        // a visible one may be a debounce behind — sync it). The old order wrote the raw
        // buffer, let the server format the file ON DISK, re-read it and wrote again: two
        // writes, and a window in which any other writer looked like the formatter.
        const runFormat = formatOnSaveRef?.current ?? null
        let formatted: string | null = null
        if (runFormat && editPath) {
          if (!workItemVisibleRef.current) {
            await backendClient.lspOpen(sessionId, editPath, savedBuffer)
          } else if (lastSyncedRef.current !== savedBuffer) {
            lastSyncedRef.current = savedBuffer
            void backendClient.lspChange(sessionId, editPath, savedBuffer)
          }
          formatted = await runFormat(savedBuffer)
        }
        // Compose cleanup before the write and adopt those exact persisted bytes.
        const composed = composeOnSaveContent(savedBuffer, formatted, getSaveCleanupPrefs())
        const written = await backendClient.writeFileContent(
          sessionId,
          path,
          composed,
          savedBaseHash,
        )
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
        return true
      } catch (err) {
        const raw = errorMessage(err, '')
        // A concurrency conflict (someone else wrote the file since we loaded it) isn't
        // a dead end: re-read the fresh disk snapshot and surface the reconcile banner
        // so the user can Compare / Overwrite / Reload instead of losing their edits.
        if (err instanceof ApiError && err.code === 'file_conflict') {
          const stale: Problem = {
            message: 'This file changed on disk while you were editing it.',
            hint: 'Reload to take the disk version, or overwrite it with your edits.',
            detail: raw || undefined,
            location: { path: editPath || path },
          }
          try {
            const cur = await backendClient.getFileContent(sessionId, path, { full: true })
            if (cur.hash != null) {
              fileContentCache.put(sessionId, path, cur)
              setConflict({ diskContent: cur.content, diskHash: cur.hash })
            } else {
              setEditError(stale)
            }
          } catch {
            setEditError(stale)
          }
          // No toast: the reconcile banner (or the `stale` problem line, which also reaches the
          // centre through the tab's problem report) stays up for as long as the file is open,
          // so a second, durable "file changed" row said the same thing twice.
        } else {
          // One owner for a failed save: `editError` is the tab's problem report, which paints the
          // line AND keeps the Event Center row until the next save succeeds. A toast beside it
          // published the same failure a second time, and one per auto-save retry.
          setEditError({
            message: `Could not save “${baseName(path)}”.`,
            detail: raw || undefined,
            location: { path: editPath || path },
          })
        }
        return false
      } finally {
        // Formatting temporarily pins the LSP document to `savedBuffer`. If the
        // user kept typing while the save ran, restore that newer live document
        // after the disk operation instead of leaving diagnostics on the snapshot.
        if (editPath && bufferRef.current !== savedBuffer) {
          const current = bufferRef.current
          lastSyncedRef.current = current
          void backendClient.lspChange(sessionId, editPath, current)
        }
        // A format-on-save can reopen the document after this work item was parked.
        // Release it again once the save settles; the next visible render opens the
        // latest buffer through the visibility-owned effect above.
        if (!workItemVisibleRef.current && editPath) {
          void backendClient.lspClose(sessionId, editPath)
        }
        savingRef.current = false
        setSaving(false)
      }
    })()
    return trackFileSaveTask(savePromiseRef, savedBuffer, task)
    // `formatOnSaveRef` is listed because it is a PARAMETER, not a ref this hook owns —
    // nothing in the signature stops a caller from handing over a fresh object each render,
    // and omitting it would then freeze `save()` on the first one forever. Inert for the
    // callers we have (a `useRef`, so the identity never changes and this memo never
    // rebuilds); `.current` is still read at call time, which is what keeps the runner live.
  }, [
    sessionId,
    path,
    buffer,
    editPath,
    formatOnSaveRef,
    workItemVisibleRef,
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

  return save
}
