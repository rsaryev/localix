import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/shared/lib/notify'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { useFileConnectionRecovery } from './useFileConnectionRecovery'
import { readyStateFor, type FileLoadState } from './fileLoadState'
export type { FileLoadState } from './fileLoadState'
import { inspector } from '@/shared/lib/inspectorBus'
import { onFsChange } from '@/shared/lib/fsChangeBus'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { onFilesReloaded } from '@/shared/lib/fileReloadBus'
import { reloadGuard } from '../lib/reloadGuard'
import {
  conflictResolutionMatches,
  onConflictResolved,
  shouldAdoptConflictResolution,
} from './conflictResolvedBus'
import { buildCompareDiff } from '../lib/compare-diff'
import { classifyDiskChange, fsChangeTouchesFile } from '../lib/conflict-reconcile'
import { AUTO_SAVE_DELAY_MS, shouldAutoSave, useAutoSave } from '@/shared/ui/code-editor/autoSave'
import { composeOnSaveContent, getSaveCleanupPrefs } from '@/shared/ui/code-editor/saveCleanup'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import {
  clearFileDraft,
  fileEditorOwnerKey,
  getFileDraft,
  getFileDraftSnapshot,
  setFileDraft,
} from '../model/fileDrafts'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { useProblemReport } from '@/shared/ui/problem-report'
import type { Problem } from '@localixai/plugin-sdk/ui/problems'
import type { FileContentResponse } from '@/shared/api/contracts'
import { ensureFileContentCacheInvalidation, fileContentCache } from '../model/fileContentCache'
import { externalLineChanges } from '@/shared/ui/code-editor/externalChanges'
import type { DirtyChange } from '@/shared/ui/code-editor/dirtyDiffGutter'
import { fileTransferReadyKey, workItemTransferReady } from '@/shared/lib/workItemTransferReady'

import type { FileConflict, FormatOnSaveRunner } from './fileEditorContracts'
export type { FileConflict, FormatOnSaveRunner } from './fileEditorContracts'
import { useFileEditorLsp } from './useFileEditorLsp'
import { useFileEditorLoad } from './useFileEditorLoad'

/** Namespace for every condition this editor publishes about a file. */
const PROBLEM_SCOPE = 'editor'

/** Quiet time before a buffer edit is sent to the language server (see `flushLspSync`). */
export { LSP_SYNC_DELAY_MS } from './useFileEditorLsp'

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
  const initialBuffer =
    initialReady?.editable && initialDraft !== undefined && initialDraft !== initialReady.content
      ? initialDraft
      : initialReady?.editable
        ? initialReady.content
        : ''
  // A recently-evicted clean text model paints synchronously, then the load effect
  // revalidates its hash. Misses retain the normal loading state.
  const [state, setState] = useState<FileLoadState>(initialReady ?? { status: 'loading' })
  // Bumped by the error-state Retry button to re-run the load (transient failures).
  const [reloadNonce, setReloadNonce] = useState(0)

  // Editable text opens straight in the editor (no Edit button). The load fetches
  // the FULL file (+ a hash) so a save never writes back a truncated buffer; save
  // uses optimistic concurrency (baseHash → 409 on drift).
  const [buffer, setBuffer] = useState(initialBuffer)
  const [baseContent, setBaseContent] = useState(
    initialSnapshot?.baseContent ?? (initialReady?.editable ? initialReady.content : ''),
  )
  const [baseHash, setBaseHash] = useState(
    initialSnapshot?.baseHash ?? (initialReady?.editable ? (initialReady.hash ?? '') : ''),
  )
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
  const savePromiseRef = useRef<{ content: string; task: Promise<boolean> } | null>(null)
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
      const initial = draft !== undefined && draft !== response.content ? draft : response.content
      const baseline = snapshot?.baseContent ?? response.content
      const baselineHash = snapshot?.baseHash ?? response.hash ?? ''
      bufferRef.current = initial
      baseContentRef.current = baseline
      baseHashRef.current = baselineHash
      setBuffer(initial)
      setBaseContent(baseline)
      setBaseHash(baselineHash)
      setEditPath(response.path)
      setConflict(
        snapshot && response.hash && response.hash !== snapshot.baseHash
          ? { diskContent: response.content, diskHash: response.hash }
          : null,
      )
      lastSyncedRef.current = initial
    },
    [sessionId, path],
  )

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
        // Keeping the buffer/base snapshot byte-identical to disk is load-bearing:
        // otherwise the editor can report clean while displaying different text.
        const composed = composeOnSaveContent(savedBuffer, formatted, getSaveCleanupPrefs())
        const res = await backendClient.writeFileContent(sessionId, path, composed, savedBaseHash)
        baseHashRef.current = res.hash
        baseContentRef.current = composed
        setBaseHash(res.hash)
        setBaseContent(composed)
        if (bufferRef.current === savedBuffer) {
          bufferRef.current = composed
          setBuffer(composed)
          lastSyncedRef.current = composed
          if (editPath && composed !== savedBuffer)
            void backendClient.lspChange(sessionId, editPath, composed)
          // The one place the language server hears "saved" — servers that check on save
          // (rust-analyzer, linters) run then, not on every pause in typing.
          if (editPath) void backendClient.lspSave(sessionId, editPath)
        }
        setConflict(null)
        fileContentCache.putText(sessionId, path, res.path, composed, res.hash)
        return true
      } catch (err) {
        const raw = errorMessage(err, '')
        // A concurrency conflict (someone else wrote the file since we loaded it) isn't
        // a dead end: re-read the fresh disk snapshot and surface the reconcile banner
        // so the user can Compare / Overwrite / Reload instead of losing their edits.
        if (/changed on disk|file_conflict/i.test(raw)) {
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
    savePromiseRef.current = { content: savedBuffer, task }
    const clearSaveTask = () => {
      if (savePromiseRef.current?.task === task) savePromiseRef.current = null
    }
    void task.then(clearSaveTask, clearSaveTask)
    return task
    // `formatOnSaveRef` is listed because it is a PARAMETER, not a ref this hook owns —
    // nothing in the signature stops a caller from handing over a fresh object each render,
    // and omitting it would then freeze `save()` on the first one forever. Inert for the
    // callers we have (a `useRef`, so the identity never changes and this memo never
    // rebuilds); `.current` is still read at call time, which is what keeps the runner live.
  }, [sessionId, path, buffer, editPath, formatOnSaveRef])

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
        const res = await backendClient.writeFileContent(sessionId, path, composed, c.diskHash)
        baseHashRef.current = res.hash
        baseContentRef.current = composed
        setBaseHash(res.hash)
        setBaseContent(composed)
        if (bufferRef.current === savedBuffer) {
          bufferRef.current = composed
          setBuffer(composed)
          lastSyncedRef.current = composed
          if (editPath && composed !== savedBuffer)
            void backendClient.lspChange(sessionId, editPath, composed)
          if (editPath) void backendClient.lspSave(sessionId, editPath)
        }
        setConflict(null)
        setEditError(null)
        // No success row: the reconcile banner closes and the tab turns clean where it was clicked.
        fileContentCache.putText(sessionId, path, res.path, composed, res.hash)
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
    savePromiseRef.current = { content: savedBuffer, task }
    const clearSaveTask = () => {
      if (savePromiseRef.current?.task === task) savePromiseRef.current = null
    }
    void task.then(clearSaveTask, clearSaveTask)
    return task
  }, [sessionId, path, buffer, conflict, editPath])

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

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setReloadNonce((n) => n + 1)
  }, [])

  // Reconcile the open buffer against the current on-disk content after an external
  // write (agent patch, formatter, another tab's rename, a build). A clean buffer
  // silently adopts the new bytes; a dirty buffer raises the conflict banner so the
  // user's unsaved edits are never clobbered. Stable (reads live state via refs).
  const reconcileFromDisk = useCallback(async () => {
    if (!sessionId || !editPath) return
    if (savingRef.current || conflictRef.current) return // mid-save / already surfaced
    try {
      // Conditional read: this path fires on every coarse FS-watch frame touching
      // the file's directory and on every visibility resume, and nearly all of them
      // find the file untouched. Handing the server our base hash lets it answer
      // "unchanged" with an empty body instead of re-shipping the whole buffer.
      const cur = await backendClient.getFileContent(sessionId, editPath, {
        full: true,
        knownHash: baseHashRef.current || undefined,
      })
      if (cur.unchanged) return
      fileContentCache.put(sessionId, path, cur)
      const action = classifyDiskChange(
        cur.hash,
        baseHashRef.current,
        bufferRef.current !== baseContentRef.current,
      )
      if (action === 'conflict') setConflict({ diskContent: cur.content, diskHash: cur.hash! })
      else if (action === 'adopt') adoptDisk(cur.content, cur.hash!)
    } catch {
      /* transient read failure — the next change signal retries */
    }
  }, [sessionId, path, editPath, adoptDisk])

  // When this file's conflict is resolved from its compare tab (disk ⟷ your edits),
  // adopt the winning side here so the reconcile banner clears cleanly — no need to
  // re-read disk or click the banner. (In the usual single-editor-group flow this
  // tab is unmounted while the compare tab is shown, so it just remounts fresh from
  // disk instead; this covers the split/both-visible case.)
  useEffect(() => {
    return onConflictResolved((r) => {
      if (!conflictResolutionMatches(sessionId, editPath, r)) return
      if (shouldAdoptConflictResolution(bufferRef.current, r)) {
        adoptDisk(r.content, r.hash)
      } else {
        setConflict({ diskContent: r.content, diskHash: r.hash })
      }
    })
  }, [sessionId, editPath, adoptDisk])

  // Re-fetch this file when a KNOWN agent write rewrites it (e.g. an F2 rename or a
  // format applied from another tab). Routed through the reload guard (per-path
  // debounce + save-settle drop) so a burst coalesces and our own save's echo never
  // races the not-yet-committed base hash; reconcileFromDisk then re-checks live
  // edit state at apply-time (unsaved edits survive as a conflict, never clobbered).
  useEffect(() => {
    if (!workItemVisible) return
    return onFilesReloaded((paths) => {
      if (editPath && paths.has(editPath))
        reloadGuard.scheduleReload(
          fileEditorOwnerKey(sessionId ?? '', editPath),
          () => void reconcileFromDisk(),
        )
    })
  }, [workItemVisible, sessionId, editPath, reconcileFromDisk])

  // Passive external-change coverage: the FS watcher publishes coarse dir-level
  // change frames. When the open file's directory is touched, reconcile — this
  // closes the gap for plain external edits / agent bash writes (which don't hit the
  // known-write bus above). Cheap: only fires for the open file's own directory.
  // The frame reaches only a connection that declares the session watched; with the Files rail
  // closed and no chat pane on it, nothing did, and the open file never saw a write. So the
  // editor declares it itself (refcounted in eventSocket) for as long as it listens.
  useEffect(() => {
    if (!workItemVisible || !sessionId || !editPath) return
    const offChange = onFsChange(({ sessionId: changed, paths }) => {
      if (changed !== sessionId) return
      if (fsChangeTouchesFile(paths, editPath))
        reloadGuard.scheduleReload(
          fileEditorOwnerKey(sessionId, editPath),
          () => void reconcileFromDisk(),
        )
    })
    const unwatch = eventSocket.watchSession(sessionId)
    return () => {
      offChange()
      unwatch()
    }
  }, [workItemVisible, sessionId, editPath, reconcileFromDisk])

  // Cancel any pending debounced reload for this path when the tab unmounts or
  // re-targets (a stale closure firing against a gone editor is pointless).
  useEffect(() => {
    if (!workItemVisible || !sessionId || !editPath) return
    const ownerKey = fileEditorOwnerKey(sessionId, editPath)
    return () => reloadGuard.cancel(ownerKey)
  }, [workItemVisible, sessionId, editPath])

  // A hidden editor deliberately ignores file-system broadcasts. When it becomes
  // visible again, reconcile once so changes that happened in the gap are not lost.
  const previousVisibleRef = useRef(workItemVisible)
  useEffect(() => {
    const resumed = workItemVisible && !previousVisibleRef.current
    previousVisibleRef.current = workItemVisible
    if (resumed && editPath) void reconcileFromDisk()
  }, [workItemVisible, editPath, reconcileFromDisk])

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
