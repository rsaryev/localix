import path from 'node:path'
import { ApiError } from '../../../lib/errors'
import { treeFsFor, trashDir, trashEntryName } from './fs-mutations'
import {
  recordFileOp,
  popLastFileOp,
  clearFileOpJournal,
  withFileOpJournalLock,
} from './file-op-journal'
import { withPathLocks, workspaceLockPaths } from '../../agent-core/tools/file/file-utils'
import { openSessionEnv, resolveAgainst, type FileOpsContext } from './file-ops-context'
import { assertNotWorkspaceRoot, attempt, requireKind } from './file-tree-guards'
import type { FileDeleteResponse, FileUndoResponse } from '../contracts'

/**
 * Delete a tree entry (file or directory tree). On the LOCAL backend the default
 * is REVERSIBLE: the entry is MOVED into the trash (`~/.localix/trash/<stamp>-<name>`)
 * and journaled so ⌘Z can restore it. `permanent: true` (Shift+Delete) removes it
 * for good via `rm -rf`. The ssh/docker backends have no local trash, so they
 * always delete permanently regardless of the flag — the UI's confirm dialog says
 * so. The UI guards both paths behind a confirm dialog.
 */
export async function deleteEntry(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  targetPath: string,
  opts?: { permanent?: boolean },
): Promise<FileDeleteResponse> {
  const { session, env, dir } = await openSessionEnv(ctx, userId, sessionId)
  const target = resolveAgainst(dir, targetPath)
  assertNotWorkspaceRoot(dir, target)
  // Never let an empty/blank path collapse to `rm -rf /` style damage.
  if (target === path.parse(target).root)
    throw new ApiError(400, 'refused', 'Refusing to delete the filesystem root')

  const isLocal = !session.executionBackend || session.executionBackend === 'local'
  const useTrash = isLocal && !opts?.permanent
  const bin = useTrash ? trashDir() : null
  const tree = treeFsFor(env)

  const run = (): Promise<FileDeleteResponse> =>
    withPathLocks(workspaceLockPaths(dir, [target, ...(bin ? [bin] : [])]), async () => {
      if (!useTrash) {
        await attempt('delete_failed', `Could not delete ${target}`, () => tree.remove(target))
        return { path: target, deleted: true }
      }

      // Move to trash. Probe kind first (for the journal + restore) — a missing
      // source is a real error.
      const entryType = await requireKind(tree, target)

      await attempt('delete_failed', `Could not create the trash ${bin}`, () => tree.mkdirp(bin!))
      const name = path.basename(target)
      // First-choice trash name; disambiguate on the (rare) same-ms collision.
      let trashPath = path.join(bin!, trashEntryName(name, Date.now()))
      if (await tree.exists(trashPath))
        trashPath = path.join(
          bin!,
          trashEntryName(name, Date.now(), Math.random().toString(36).slice(2, 8)),
        )

      await attempt('delete_failed', `Could not delete ${target}`, () =>
        tree.move(target, trashPath),
      )
      recordFileOp(sessionId, {
        kind: 'trash',
        workspaceRoot: dir,
        original: target,
        trashPath,
        entryType,
      })
      return { path: target, deleted: true, trashed: true }
    })
  return useTrash ? withFileOpJournalLock(sessionId, run) : run()
}

/**
 * Reverse the most recent reversible file op on this session's journal (⌘Z):
 *   - `trash`  → move the entry back from the trash to its original path
 *   - `move`   → move the entry back from `to` to `from` (rename / paste-move)
 * Refuses gracefully (409) when the restore target is now occupied, leaving the op
 * consumed only on success (it's re-pushed on a conflict so a later undo can retry
 * once the user clears the way). Returns `{ undone: false }` when the journal is
 * empty.
 */
export async function undoLastFileOp(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
): Promise<FileUndoResponse> {
  const { env, dir } = await openSessionEnv(ctx, userId, sessionId)
  return withFileOpJournalLock(sessionId, async () => {
    const op = popLastFileOp(sessionId)
    if (!op) return { undone: false }
    // The session's directory can change between an operation and Undo. Absolute
    // journal paths belong only to the workspace snapshot that created them.
    if (path.resolve(op.workspaceRoot) !== path.resolve(dir)) {
      clearFileOpJournal(sessionId)
      return { undone: false }
    }

    const source = op.kind === 'trash' ? op.trashPath : op.to
    const dest = op.kind === 'trash' ? op.original : op.from
    const tree = treeFsFor(env)

    return withPathLocks(workspaceLockPaths(dir, [source, dest]), async () => {
      // The restore target must be free, else we'd clobber a newer entry.
      if (await tree.exists(dest)) {
        recordFileOp(sessionId, op) // keep it for a later retry
        throw new ApiError(
          409,
          'undo_conflict',
          `Cannot undo — “${path.basename(dest)}” already exists again.`,
        )
      }
      // Make sure the parent dir exists (a trashed entry's parent may have gone).
      try {
        await attempt('undo_failed', 'Could not undo the last file operation', async () => {
          await tree.mkdirp(path.dirname(dest))
          await tree.move(source, dest)
        })
      } catch (error) {
        recordFileOp(sessionId, op) // preserve on failure so nothing is silently lost
        throw error
      }
      const affectedDirs = [...new Set([path.dirname(dest), path.dirname(source)].filter(Boolean))]
      return { undone: true, kind: op.kind, affectedDirs, restoredPath: dest }
    })
  })
}
