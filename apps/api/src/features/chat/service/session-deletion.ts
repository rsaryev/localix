import { clearFileOpJournal } from './file-op-journal'
import { sessionSubtreeForDeletion } from '../session-subtree'
import type { BaseCwdSession } from '../session-cwd'

/** Runtime resources and storage required to tear down a session tree. */
export interface SessionDeletionContext {
  /** Announce committed row removal before fallible filesystem cleanup. */
  onSessionsDeleted?: (userId: string, sessionIds: string[]) => void
  requireSession: (userId: string, id: string) => Promise<BaseCwdSession>
  repo: {
    deleteSession: (
      userId: string,
      id: string,
      stoppedSessionIds: readonly string[],
    ) => Promise<void>
    listChildSessionIds: (userId: string, id: string) => Promise<string[]>
  }
  runner: {
    withSessionsQuiesced: <T>(ids: readonly string[], operation: () => Promise<T>) => Promise<T>
    stop: (id: string) => Promise<boolean>
    forgetSession: (userId: string, id: string) => Promise<void>
  }
  closeSessionTerminals?: (userId: string, sessionId: string) => void
  closeSessionPreview?: (userId: string, sessionId: string) => void
  releaseSessionWatch?: (sessionId: string) => void
  /**
   * Remove the data plugins keep for these sessions (`plugins/session-storage.ts`). Unlike the
   * sandbox it belongs to EVERY session in the tree — project sessions and sub-sessions too.
   */
  discardSessionData?: (sessionIds: readonly string[]) => Promise<void>
}

export async function deleteSession(
  ctx: SessionDeletionContext,
  userId: string,
  id: string,
): Promise<void> {
  await ctx.requireSession(userId, id)
  // Stop live work BEFORE deleting rows: child jobs/sub-agents first (their
  // kill actions), then the session's own run — otherwise the run keeps
  // streaming into deleted rows and background processes outlive the session.
  // A failed read is not an empty tree, and a failed stop is not acknowledgement of teardown.
  // Preserve storage on either failure so callers can retry after the runtime settles.
  const orderedIds = await sessionSubtreeForDeletion(id, (parentId) =>
    ctx.repo.listChildSessionIds(userId, parentId),
  )
  const childIds = orderedIds.filter((sessionId) => sessionId !== id)
  return ctx.runner.withSessionsQuiesced(orderedIds, async () => {
    for (const childId of childIds) {
      await ctx.runner.stop(childId)
      await ctx.runner.forgetSession(userId, childId)
      ctx.closeSessionTerminals?.(userId, childId)
      ctx.closeSessionPreview?.(userId, childId)
      ctx.releaseSessionWatch?.(childId)
      clearFileOpJournal(childId)
    }
    await ctx.runner.stop(id)
    // Reap process-lifetime runtime state (plugin-started flag, external-session
    // keys, wake queue) — the run's own teardown only clears run-scoped maps.
    await ctx.runner.forgetSession(userId, id)
    // Reap PTY panes bound to this session — they have no UI handle once it's gone.
    ctx.closeSessionTerminals?.(userId, id)
    // Clear any pending `browser` relay commands for this session.
    ctx.closeSessionPreview?.(userId, id)
    // Close its live file-tree watcher (frees the fs handle / shared-root refcount).
    ctx.releaseSessionWatch?.(id)
    // Reap the in-memory file-tree Undo journal — a per-session-ever map key that
    // otherwise survives forever (recordFileOp never deletes the key, only caps the
    // stack; popLastFileOp deletes only when the stack drains to empty). A deleted
    // session can never undo, so the journal is dead.
    clearFileOpJournal(id)
    await ctx.repo.deleteSession(userId, id, orderedIds)
    ctx.onSessionsDeleted?.(userId, orderedIds)
    // Its scratch directory, monitors, loops and inbox rows go in the session-residue reactor
    // (`session-residue.ts`), from the committed deletion of every id in the tree.
    // Every session of the tree, whatever its sandbox rules: a game played in a project chat or
    // a sub-session goes with it. After the rows, so no ownership check can write it back.
    await ctx.discardSessionData?.(orderedIds)
  })
}
