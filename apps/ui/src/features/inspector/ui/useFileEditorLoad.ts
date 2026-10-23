import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { backendClient } from '@/shared/api/client'
import { isRecoverableReadError } from '@/shared/api/readRecovery'
import type { FileContentResponse } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { fileContentCache } from '../model/fileContentCache'
import { classifyDiskChange } from '../lib/conflict-reconcile'
import type { FileLoadState } from './fileLoadState'
import type { FileConflict } from './fileEditorContracts'

interface FileEditorLoadOptions {
  workItemVisible: boolean
  sessionId: string | null
  path: string
  reloadNonce: number
  loadKey: string
  loadedKeyRef: RefObject<string | null>
  initialCached: FileContentResponse | null
  installResponse: (response: FileContentResponse, restoreDraft: boolean) => void
  failedConnectionRef: RefObject<boolean>
  bufferRef: RefObject<string>
  baseContentRef: RefObject<string>
  baseHashRef: RefObject<string>
  setState: Dispatch<SetStateAction<FileLoadState>>
  setConflict: Dispatch<SetStateAction<FileConflict | null>>
  setEditError: Dispatch<SetStateAction<Problem | null>>
}

export function useFileEditorLoad({
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
}: FileEditorLoadOptions) {
  useEffect(() => {
    if (!workItemVisible || !sessionId || loadedKeyRef.current === loadKey) return
    let cancelled = false
    const loadController = new AbortController()
    const cached = reloadNonce === 0 ? initialCached : null
    // Full read (untruncated + hash) so editable files can open straight in the editor.
    // Retiring the tab aborts the transport too: a boolean guard alone drops the
    // response but still makes the API read, transfer and parse a file nobody will use.
    backendClient
      .getFileContent(sessionId, path, {
        full: true,
        ...(cached?.hash ? { knownHash: cached.hash } : {}),
        signal: loadController.signal,
        onRecovery: () => {
          if (!cancelled && !cached) setState({ status: 'loading', reconnecting: true })
        },
      })
      .then((res) => {
        if (cancelled) return
        loadedKeyRef.current = loadKey
        failedConnectionRef.current = false
        if (res.unchanged) return
        fileContentCache.put(sessionId, path, res)
        if (cached) {
          // A cache hit can predate the file growing past the full-read safety cap.
          // Such a response has no concurrency hash: replace a clean snapshot with
          // the truthful read-only/truncated state, but never erase live typing.
          if (res.hash == null) {
            if (bufferRef.current !== baseContentRef.current) {
              // No `location`: the report's subject already carries the file, and reading
              // `editPath` here would pull it into this effect's dependencies.
              setEditError({
                message: 'This file changed on disk and grew past the size this editor reconciles.',
                hint: 'Copy your unsaved edits elsewhere before reloading — they cannot be merged.',
              })
            } else {
              installResponse(res, false)
            }
            return
          }
          const action = classifyDiskChange(
            res.hash,
            baseHashRef.current,
            bufferRef.current !== baseContentRef.current,
          )
          if (action === 'conflict') {
            setConflict({ diskContent: res.content, diskHash: res.hash! })
          } else if (action === 'adopt') {
            installResponse(res, false)
          }
        } else {
          // Seed the editor + restore a surviving unsaved draft on a cold load.
          installResponse(res, true)
        }
      })
      .catch((err) => {
        // A cache hit is still useful while offline. Keep it visible and retry on
        // the next remount instead of replacing good text with a transient error.
        if (!cancelled && !loadController.signal.aborted && !cached) {
          failedConnectionRef.current = isRecoverableReadError(err)
          if (failedConnectionRef.current) {
            setState({ status: 'loading', reconnecting: true })
            return
          }
          setState({
            status: 'error',
            // The backend answers `Cannot read /very/long/absolute/path` for every failure mode
            // it cannot tell apart — deleted, unreadable, or the environment gone. That path wall
            // was the whole sentence a person got; it is now the detail behind a readable one.
            message: 'This file could not be read.',
            detail: errorMessage(err, '') || undefined,
          })
        }
      })
    return () => {
      cancelled = true
      loadController.abort()
    }
  }, [
    workItemVisible,
    sessionId,
    path,
    reloadNonce,
    loadKey,
    initialCached,
    installResponse,
    failedConnectionRef,
    loadedKeyRef,
    bufferRef,
    baseContentRef,
    baseHashRef,
    setState,
    setConflict,
    setEditError,
  ])
}
