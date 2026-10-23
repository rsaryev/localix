import { useCallback, useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { useFileConnectionRecovery } from './useFileConnectionRecovery'
import { readyStateFor, type FileLoadState } from './fileLoadState'
export type { FileLoadState } from './fileLoadState'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { AUTO_SAVE_DELAY_MS, shouldAutoSave, useAutoSave } from '@/shared/ui/code-editor/autoSave'
import {
  clearFileDraft,
  getFileDraft,
  getFileDraftSnapshot,
  setFileDraft,
} from '../model/fileDrafts'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useProblemReport } from '@/shared/ui/problem-report'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import type { FileContentResponse } from '@/shared/api/contracts'
import { ensureFileContentCacheInvalidation, fileContentCache } from '../model/fileContentCache'
import { externalLineChanges } from '@/shared/ui/code-editor/externalChanges'
import type { DirtyChange } from '@/shared/ui/code-editor/dirtyDiffGutter'
import { fileTransferReadyKey, workItemTransferReady } from '@/shared/lib/workItemTransferReady'

import type { FileConflict, FileEditorWriteState, FormatOnSaveRunner } from './fileEditorContracts'
export type { FileConflict, FormatOnSaveRunner } from './fileEditorContracts'
import { useFileEditorLsp } from './useFileEditorLsp'
import { useFileEditorLoad } from './useFileEditorLoad'
import { useFileEditorReconcile } from './useFileEditorReconcile'
import { useFileEditorSave } from './useFileEditorSave'
import { editorSnapshotFor } from './fileEditorSnapshot'
import { useFileConflictActions } from './useFileConflictActions'
import type { PendingFileSave } from './fileSaveTask'

/** Namespace for every condition this editor publishes about a file. */
const PROBLEM_SCOPE = 'editor'

/** Quiet time before a buffer edit is sent to the language server (see `flushLspSync`). */

/**
 * The inspector file panel's load + edit-buffer state machine, extracted from
 * FileTab so the component carries only presentation + comment wiring.
 *
 * Owns: the full-file load (untruncated + hash), the editable buffer + base
 * snapshot, optimistic-concurrency save, debounced LSP didChange sync, the
 * markdown preview toggle, and external-change reconciliation (auto-reload a
 * clean buffer, surface a Compare/Overwrite/Reload banner for a dirty one).
 * The buffer/editPath it returns feed the comment layer.
 */
export function useFileEditor(
  sessionId: string | null,
  path: string,
  formatOnSaveRef?: { current: FormatOnSaveRunner | null },
) {
  const workItemVisible = useWorkItemVisible()
  const workItemVisibleRef = useRef(workItemVisible)
  workItemVisibleRef.current = workItemVisible
  const [initialCached] = useState(() =>
    sessionId ? (fileContentCache.get(sessionId, path) ?? null) : null,
  )
  const initialReady = initialCached ? readyStateFor(path, initialCached) : null
  const initialDraft =
    sessionId && initialReady?.editable ? getFileDraft(sessionId, initialReady.absPath) : undefined
  const initialSnapshot =
    sessionId && initialReady?.editable
      ? getFileDraftSnapshot(sessionId, initialReady.absPath)
      : undefined
  const initialEdit = editorSnapshotFor(initialReady, initialDraft, initialSnapshot)
  const initialBuffer = initialEdit.buffer
  // A recently-evicted clean text model paints synchronously, then the load effect
  // revalidates its hash. Misses retain the normal loading state.
  const [state, setState] = useState<FileLoadState>(initialReady ?? { status: 'loading' })
  // Bumped by the error-state Retry button to re-run the load (transient failures).
  const [reloadNonce, setReloadNonce] = useState(0)

  // Editable text opens straight in the editor (no Edit button). The load fetches
  // the FULL file (+ a hash) so a save never writes back a truncated buffer; save
  // uses optimistic concurrency (baseHash → 409 on drift).
  const [buffer, setBuffer] = useState(initialBuffer)
  const [baseContent, setBaseContent] = useState(initialEdit.baseContent)
  const [baseHash, setBaseHash] = useState(initialEdit.baseHash)
  // Absolute path the backend resolved for the open buffer — the key both the LSP
  // document sync and the diagnostics stream use (the `path` prop may be relative).
  const [editPath, setEditPath] = useState(initialReady?.editable ? initialReady.absPath : '')
  const [saving, setSaving] = useState(false)
  // A save that failed, as a Problem rather than a sentence: the backend answers `…/x.ts changed
  // on disk since it was opened` — true, path-wall, and not what belongs on a status line.
  const [editError, setEditError] = useState<Problem | null>(null)
  // Set when the file changed on disk under an unsaved buffer — drives the
  // reconciliation banner. Cleared on any successful save/reload.
  const [conflict, setConflict] = useState<FileConflict | null>(null)
  // Lines the last adopted external write changed — highlighted until the next user edit.
  const [externalChanges, setExternalChanges] = useState<DirtyChange[] | undefined>(undefined)
  // Markdown only: flip the editor to a rendered, read-only preview of the buffer.
  const [previewMarkdown, setPreviewMarkdown] = useState(false)
  const dirty = Boolean(editPath) && buffer !== baseContent
  useEffect(() => {
    if (!sessionId || !workItemVisible) return
    if (state.status === 'ready' && state.editable && editPath) {
      workItemTransferReady.success(fileTransferReadyKey(sessionId, editPath))
    } else if (state.status === 'error') {
      workItemTransferReady.failure(fileTransferReadyKey(sessionId, path), state.message)
    }
  }, [sessionId, path, workItemVisible, state, editPath])

  // The content the language server last received. Compared against (NOT baseContent)
  // so that fixing an error back to the original text STILL syncs — otherwise the
  // server keeps reporting the stale error and the squiggle never clears.
  const lastSyncedRef = useRef(initialBuffer)

  // Live mirrors of the mutable edit state so the (stably-subscribed) disk-change
  // reconciler reads current values without re-subscribing on every keystroke.
  const bufferRef = useRef(buffer)
  const baseContentRef = useRef(baseContent)
  const baseHashRef = useRef(baseHash)
  const savingRef = useRef(saving)
  const conflictRef = useRef(conflict)
  const savePromiseRef = useRef<PendingFileSave | null>(null)
  useEffect(() => {
    bufferRef.current = buffer
  }, [buffer])
  // A keystroke updates the mirror synchronously, not after the next render: Monaco asks for
  // completions (or a quick fix) in the same tick as the edit, and `flushLspSync` must send
  // the text that request is about — not the one before it.
  const editBuffer = useCallback((value: string) => {
    bufferRef.current = value
    setBuffer(value)
  }, [])
  useEffect(() => {
    baseContentRef.current = baseContent
  }, [baseContent])
  useEffect(() => {
    baseHashRef.current = baseHash
  }, [baseHash])
  useEffect(() => {
    savingRef.current = saving
  }, [saving])
  useEffect(() => {
    conflictRef.current = conflict
  }, [conflict])
  useEffect(() => {
    ensureFileContentCacheInvalidation()
  }, [])

  // No per-owner reset effect needed: FileTab remounts this state machine with a
  // session+path key, so neither kind of ownership change can retain edit state.

  // Mirror the DIRTY buffer into the module-level draft store on every change, and
  // clear it the moment the buffer is clean again (save / adopt / discard). The
  // grid renders only a group's ACTIVE tab, so switching tabs unmounts this hook —
  // the draft is what lets the unsaved edits survive that unmount (re-adopted by
  // the load effect below on remount).
  useEffect(() => {
    if (!sessionId || !editPath) return
    if (dirty) setFileDraft(sessionId, editPath, buffer, { baseContent, baseHash })
    else clearFileDraft(sessionId, editPath)
  }, [sessionId, editPath, buffer, dirty, baseContent, baseHash])

  const flushLspSync = useFileEditorLsp({
    sessionId,
    editPath,
    workItemVisible,
    workItemVisibleRef,
    buffer,
    bufferRef,
    lastSyncedRef,
  })

  // Adopt fresh on-disk content into the buffer + base snapshot (silent reload of a
  // clean buffer, or the explicit "discard my edits" reconcile action). Re-syncs the
  // language server so squiggles reflect the new content.
  const adoptDisk = useCallback(
    (content: string, hash: string) => {
      // Both sides are in hand only here: say which lines the external write changed, so
      // the reload is seen, not just silently swapped in (`externalChanges.ts`).
      setExternalChanges(externalLineChanges(bufferRef.current, content))
      bufferRef.current = content
      baseContentRef.current = content
      baseHashRef.current = hash
      setBuffer(content)
      setBaseContent(content)
      setBaseHash(hash)
      setConflict(null)
      setEditError(null)
      lastSyncedRef.current = content
      if (sessionId && editPath) fileContentCache.putText(sessionId, path, editPath, content, hash)
      if (sessionId && editPath) void backendClient.lspChange(sessionId, editPath, content)
    },
    [sessionId, path, editPath],
  )

  const installResponse = useCallback(
    (response: FileContentResponse, restoreDraft: boolean) => {
      const ready = readyStateFor(path, response)
      setState(ready)
      if (!ready.editable) {
        setBuffer('')
        setBaseContent('')
        setBaseHash('')
        setEditPath('')
        return
      }
      const draft = restoreDraft && sessionId ? getFileDraft(sessionId, response.path) : undefined
      const snapshot =
        restoreDraft && sessionId ? getFileDraftSnapshot(sessionId, response.path) : undefined
      const next = editorSnapshotFor(ready, draft, snapshot)
      bufferRef.current = next.buffer
      baseContentRef.current = next.baseContent
      baseHashRef.current = next.baseHash
      setBuffer(next.buffer)
      setBaseContent(next.baseContent)
      setBaseHash(next.baseHash)
      setEditPath(response.path)
      setConflict(next.conflict)
      lastSyncedRef.current = next.buffer
    },
    [sessionId, path],
  )

  const writeState: FileEditorWriteState = {
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
  }
  const save = useFileEditorSave({
    sessionId,
    path,
    buffer,
    editPath,
    formatOnSaveRef,
    workItemVisibleRef,
    ...writeState,
  })

  // Auto-save after a delay: when the preference is on,
  // a dirty buffer saves itself through the SAME save() path after an idle delay.
  // The timer resets on every keystroke (debounce). A 409 sets `conflict`, which
  // closes the gate — so an auto-save can surface the reconcile banner but never
  // loops; resolving the conflict/error re-opens the gate.
  const autoSaveEnabled = useAutoSave()
  useEffect(() => {
    if (
      !shouldAutoSave({
        enabled: autoSaveEnabled,
        dirty,
        saving,
        hasConflict: Boolean(conflict),
        hasError: Boolean(editError),
      })
    )
      return
    const id = setTimeout(() => {
      void save()
    }, AUTO_SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [autoSaveEnabled, dirty, saving, conflict, editError, buffer, save])

  const { overwrite, reloadFromDisk, compareWithDisk } = useFileConflictActions({
    sessionId,
    path,
    buffer,
    editPath,
    conflict,
    adoptDisk,
    ...writeState,
  })

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setReloadNonce((n) => n + 1)
  }, [])

  const reconcileFromDisk = useFileEditorReconcile({
    sessionId,
    path,
    editPath,
    workItemVisible,
    bufferRef,
    baseContentRef,
    baseHashRef,
    savingRef,
    conflictRef,
    adoptDisk,
    setConflict,
  })

  const loadKey = `${sessionId ?? ''}\x00${path}\x00${reloadNonce}`
  const loadedKeyRef = useRef<string | null>(null)
  const failedConnectionRef = useFileConnectionRecovery(
    workItemVisible,
    sessionId,
    editPath,
    bufferRef,
    retry,
    reconcileFromDisk,
  )
  useFileEditorLoad({
    workItemVisible,
    sessionId,
    path,
    reloadNonce,
    loadKey,
    loadedKeyRef,
    initialCached,
    installResponse,
    failedConnectionRef,
    bufferRef,
    baseContentRef,
    baseHashRef,
    setState,
    setConflict,
    setEditError,
  })

  // The tab's ONE standing condition. A file that failed to load has no editor to fail a save in,
  // so the two can never both be true — and one owner is what the centre requires: a second hook
  // on the same subject would settle this one's row.
  const problem = useProblemReport(
    state.status === 'error'
      ? {
          subject: { label: baseName(path), path },
          problems: [{ message: state.message, detail: state.detail, location: { path } }],
          consequence: 'blocked',
        }
      : editError
        ? {
            subject: { label: baseName(path), path: editPath || path },
            problems: [editError],
            consequence: 'none',
          }
        : null,
    {
      scope: PROBLEM_SCOPE,
      sourceVisible: workItemVisible,
      // A read that failed is worth retrying from the centre too: the person who finds the row an
      // hour later should not have to go looking for the tab that produced it.
      actions: state.status === 'error' ? [{ id: 'retry', label: 'Retry', run: retry }] : undefined,
    },
  )

  return {
    state,
    retry,
    buffer,
    setBuffer: editBuffer,
    /** Send the live buffer to the language server now, if it is behind. */
    flushLspSync,
    baseHash,
    editPath,
    dirty,
    saving,
    problem,
    conflict,
    externalChanges,
    overwrite,
    reloadFromDisk,
    compareWithDisk,
    previewMarkdown,
    togglePreview: useCallback(() => setPreviewMarkdown((v) => !v), []),
    save,
  }
}
