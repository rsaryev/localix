import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { onFsChange } from '@/shared/lib/fsChangeBus'
import { onFilesReloaded } from '@/shared/lib/fileReloadBus'
import { reloadGuard } from '../lib/reloadGuard'
import { fileEditorOwnerKey } from '../model/fileDrafts'
import { fileContentCache } from '../model/fileContentCache'
import { classifyDiskChange, fsChangeTouchesFile } from '../lib/conflict-reconcile'
import {
  conflictResolutionMatches,
  onConflictResolved,
  shouldAdoptConflictResolution,
} from './conflictResolvedBus'
import type { FileConflict } from './fileEditorContracts'

interface FileEditorReconcileOptions {
  sessionId: string | null
  path: string
  editPath: string
  workItemVisible: boolean
  bufferRef: RefObject<string>
  baseContentRef: RefObject<string>
  baseHashRef: RefObject<string>
  savingRef: RefObject<boolean>
  conflictRef: RefObject<FileConflict | null>
  adoptDisk: (content: string, hash: string) => void
  setConflict: Dispatch<SetStateAction<FileConflict | null>>
}

export function useFileEditorReconcile({
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
}: FileEditorReconcileOptions) {
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
  }, [
    sessionId,
    path,
    editPath,
    adoptDisk,
    savingRef,
    conflictRef,
    baseHashRef,
    bufferRef,
    baseContentRef,
    setConflict,
  ])

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
  }, [sessionId, editPath, adoptDisk, bufferRef, setConflict])

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

  return reconcileFromDisk
}
