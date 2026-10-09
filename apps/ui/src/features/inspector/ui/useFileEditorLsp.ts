import { useCallback, useEffect, type RefObject } from 'react'
import { backendClient } from '@/shared/api/client'

/** Quiet time before a buffer edit is sent to the language server. */
export const LSP_SYNC_DELAY_MS = 40

interface FileEditorLspOptions {
  sessionId: string | null
  editPath: string
  workItemVisible: boolean
  workItemVisibleRef: RefObject<boolean>
  buffer: string
  bufferRef: RefObject<string>
  lastSyncedRef: RefObject<string>
}

export function useFileEditorLsp({
  sessionId,
  editPath,
  workItemVisible,
  workItemVisibleRef,
  buffer,
  bufferRef,
  lastSyncedRef,
}: FileEditorLspOptions) {
  // Buffer → language-server sync (didChange). Diagnostics return on the firehose, so
  // this is fire-and-forget. `editPath` is only set for an open file.
  //
  // The delay is the first link of the "typed an error → red squiggle" chain, and every
  // later link (the server's own check delay, tsserver, the publish debounce) waits for
  // it, so it is short: long enough to fold a burst of keystrokes into one sync, not a
  // perceptible pause. The server sends only the delta (`lsp-incremental.ts`), so a sync
  // per short pause is cheap. A request that needs the document NOW (completion, hover,
  // a quick fix) does not wait for it at all — it flushes first (`flushLspSync`).
  const flushLspSync = useCallback(() => {
    const text = bufferRef.current
    if (!workItemVisibleRef.current || !sessionId || !editPath) return
    if (text === lastSyncedRef.current) return
    lastSyncedRef.current = text
    void backendClient.lspChange(sessionId, editPath, text)
  }, [sessionId, editPath])
  useEffect(() => {
    if (!workItemVisible || !sessionId || !editPath || buffer === lastSyncedRef.current) return
    const id = setTimeout(flushLspSync, LSP_SYNC_DELAY_MS)
    return () => clearTimeout(id)
  }, [workItemVisible, sessionId, editPath, buffer, flushLspSync])

  // The server-side LSP document follows GRID visibility, not mount lifetime: warm
  // editors stay mounted under display:none, but their language-server resources do not.
  // Re-show opens the latest buffer (including an unsaved draft) without re-reading disk.
  useEffect(() => {
    if (!workItemVisible || !sessionId || !editPath) return
    void backendClient.lspOpen(sessionId, editPath, bufferRef.current)
    return () => {
      void backendClient.lspClose(sessionId, editPath)
    }
  }, [workItemVisible, sessionId, editPath])

  return flushLspSync
}
