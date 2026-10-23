import type { RefObject } from 'react'
import { backendClient } from '@/shared/api/client'
import { fileContentCache } from '../model/fileContentCache'
import type { FileEditorWriteState } from './fileEditorContracts'

export interface PendingFileSave {
  content: string
  task: Promise<boolean>
}

/** A completed older write must not clear the slot now occupied by a newer write. */
export function trackFileSaveTask(
  pending: RefObject<PendingFileSave | null>,
  content: string,
  task: Promise<boolean>,
): Promise<boolean> {
  pending.current = { content, task }
  const clear = () => {
    if (pending.current?.task === task) pending.current = null
  }
  void task.then(clear, clear)
  return task
}

/**
 * After a write, adopt the exact persisted bytes as the editor's base. Keeping the buffer/base
 * snapshot byte-identical to disk is load-bearing: otherwise the editor can report clean while
 * displaying different text. The buffer itself is only replaced when nothing was typed during the
 * write, and only then does the language server hear the new text and "saved" — the one place it
 * does, so servers that check on save (rust-analyzer, linters) run then, not on every pause.
 */
export function adoptWrittenFile(
  state: Pick<
    FileEditorWriteState,
    | 'bufferRef'
    | 'baseContentRef'
    | 'baseHashRef'
    | 'lastSyncedRef'
    | 'setBaseHash'
    | 'setBaseContent'
    | 'setBuffer'
    | 'setConflict'
  >,
  write: {
    sessionId: string
    path: string
    editPath: string
    savedBuffer: string
    composed: string
    written: { path: string; hash: string }
  },
): void {
  const { sessionId, path, editPath, savedBuffer, composed, written } = write
  state.baseHashRef.current = written.hash
  state.baseContentRef.current = composed
  state.setBaseHash(written.hash)
  state.setBaseContent(composed)
  if (state.bufferRef.current === savedBuffer) {
    state.bufferRef.current = composed
    state.setBuffer(composed)
    state.lastSyncedRef.current = composed
    if (editPath && composed !== savedBuffer)
      void backendClient.lspChange(sessionId, editPath, composed)
    if (editPath) void backendClient.lspSave(sessionId, editPath)
  }
  state.setConflict(null)
  fileContentCache.putText(sessionId, path, written.path, composed, written.hash)
}
