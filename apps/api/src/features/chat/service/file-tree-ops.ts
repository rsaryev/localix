import path from 'node:path'

import { ApiError } from '../../../lib/errors'
import { assertNotIntoSelf, treeFsFor, trashDir, trashEntryName, type TreeFs } from './fs-mutations'
import {
  recordFileOp,
  popLastFileOp,
  clearFileOpJournal,
  withFileOpJournalLock,
} from './file-op-journal'
import { withPathLocks, workspaceLockPaths } from '../../agent-core/tools/file/file-utils'
import { revealPath } from '../../projects/native-dialogs'
import { openSessionEnv, resolveAgainst, type FileOpsContext } from './file-ops-context'
import type { FileDeleteResponse, FileEntryResponse, FileUndoResponse } from '../contracts'

/**
 * The file-TREE surface of the inspector explorer: create / rename / paste /
 * delete / duplicate / undo / reveal. Every mutation is backend-agnostic (it runs
 * through the {@link TreeFs} port for the session's environment: native fs for a
 * local session, the far-side shell otherwise), serialized against the agent's
 * own writes by the shared per-path lock, and — where reversible — journaled so
 * ⌘Z can undo it.
 */

/**
 * Validate a single path SEGMENT typed in the file tree (new file/folder name or
 * rename target). Cross-platform safe: no path separators, no traversal, no
 * trailing dot/space (illegal on Windows), within a sane length. Throws 400 so the
 * UI surfaces the reason inline.
 */
const validateSegment = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) throw new ApiError(400, 'invalid_name', 'Name cannot be empty')
  if (trimmed === '.' || trimmed === '..') throw new ApiError(400, 'invalid_name', 'Reserved name')
  if (/[\\/]/.test(trimmed))
    throw new ApiError(400, 'invalid_name', 'Name cannot contain a path separator')
  // oxlint-disable-next-line no-control-regex -- reject control chars + Windows-illegal glyphs
  if (/[\x00-\x1f<>:"|?*]/.test(trimmed))
    throw new ApiError(400, 'invalid_name', 'Name contains an illegal character')
  if (/[. ]$/.test(trimmed))
    throw new ApiError(400, 'invalid_name', 'Name cannot end with a space or dot')
  if (trimmed.length > 255) throw new ApiError(400, 'invalid_name', 'Name is too long')
  return trimmed
}

/** The explorer mutates entries UNDER its root, never the session workspace itself. */
const assertNotWorkspaceRoot = (root: string, target: string): void => {
  if (path.resolve(target) === path.resolve(root))
    throw new ApiError(400, 'refused', 'Refusing to mutate the session workspace root')
}

/** Throw a 409 if `target` (an absolute path) already exists. */
const ensureAbsent = async (tree: TreeFs, target: string): Promise<void> => {
  if (await tree.exists(target))
    throw new ApiError(409, 'already_exists', 'A file with that name already exists')
}

/**
 * Run one tree primitive, turning its failure into the typed 500 the UI shows. The
 * port throws the backend's own reason (stderr, or the errno message) so the
 * person sees why, not just that, it failed.
 */
const attempt = async (code: string, fallback: string, op: () => Promise<void>): Promise<void> => {
  try {
    await op()
  } catch (error) {
    throw new ApiError(500, code, (error instanceof Error && error.message) || fallback)
  }
}

/** The entry's kind, or a 404 when it is gone. */
const requireKind = async (tree: TreeFs, target: string): Promise<'dir' | 'file'> => {
  const kind = await tree.kind(target)
  if (!kind) throw new ApiError(404, 'not_found', `${target} does not exist`)
  return kind
}

/**
 * Create a new empty file or directory under `parentPath`. The name is a single
 * validated segment; the parent is created if missing. Refuses to clobber an
 * existing entry (409). Backend-agnostic via the session's execution environment.
 */
export async function createEntry(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  parentPath: string,
  name: string,
  kind: 'file' | 'dir',
): Promise<FileEntryResponse> {
  const { env, dir } = await openSessionEnv(ctx, userId, sessionId)
  const segment = validateSegment(name)
  const parent = resolveAgainst(dir, parentPath)
  const target = path.join(parent, segment)
  const tree = treeFsFor(env)

  return withPathLocks(workspaceLockPaths(dir, [target]), async () => {
    await ensureAbsent(tree, target)
    await attempt('create_failed', `Could not create ${target}`, () =>
      kind === 'dir' ? tree.mkdirp(target) : tree.createFile(target),
    )
    return { path: target, type: kind }
  })
}

/**
 * Rename/move a tree entry within its own directory. `newName` is a single
 * validated segment (no moving across folders from the tree). Refuses to clobber
 * an existing sibling (409).
 */
export async function renameEntry(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  targetPath: string,
  newName: string,
): Promise<FileEntryResponse> {
  const { env, dir } = await openSessionEnv(ctx, userId, sessionId)
  const segment = validateSegment(newName)
  const source = resolveAgainst(dir, targetPath)
  assertNotWorkspaceRoot(dir, source)
  const dest = path.join(path.dirname(source), segment)
  const tree = treeFsFor(env)

  return withFileOpJournalLock(sessionId, () =>
    withPathLocks(workspaceLockPaths(dir, [source, dest]), async () => {
      const entryType = await requireKind(tree, source)
      if (dest === source) return { path: source, type: entryType }

      await ensureAbsent(tree, dest)
      await attempt('rename_failed', `Could not rename ${source}`, () => tree.move(source, dest))
      // Journal the rename so ⌘Z can move it back.
      recordFileOp(sessionId, {
        kind: 'move',
        workspaceRoot: dir,
        from: source,
        to: dest,
        entryType,
      })
      return { path: dest, type: entryType }
    }),
  )
}

/**
 * Compute the next duplicate name for a copy-paste collision, using a "simple"
 * incremental scheme:
 *   report.txt      → report copy.txt
 *   report copy.txt → report copy 2.txt
 *   report copy 3   → report copy 4
 * Folders keep the whole name as the prefix (no extension split). Pure + testable.
 */
export function incrementName(name: string, isFolder: boolean): string {
  let prefix = name
  let ext = ''
  if (!isFolder) {
    ext = path.extname(name)
    prefix = path.basename(name, ext)
  }
  const m = /^(.+ copy)(?: (\d+))?$/.exec(prefix)
  if (m) {
    const n = m[2] ? Number.parseInt(m[2], 10) : 1
    return `${m[1]} ${n + 1}${ext}`
  }
  return `${prefix} copy${ext}`
}

/**
 * Move or copy a tree entry INTO a destination directory (the explorer's
 * cut/copy → paste). `mode: 'move'` renames across folders; `mode: 'copy'`
 * duplicates the tree (`cp -R`). On a copy name-collision we auto-increment
 * ({@link incrementName}) — the "Duplicate" ergonomic — rather than clobber; a
 * move-collision refuses (409). Refuses to paste a directory into itself or a
 * descendant (would loop). Backend-agnostic via {@link treeFsFor}.
 */
export async function pasteEntry(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  sourcePath: string,
  destDirPath: string,
  mode: 'move' | 'copy',
): Promise<FileEntryResponse> {
  const { env, dir } = await openSessionEnv(ctx, userId, sessionId)
  const source = resolveAgainst(dir, sourcePath)
  assertNotWorkspaceRoot(dir, source)
  const destDir = resolveAgainst(dir, destDirPath)
  const baseName = path.basename(source)
  const tree = treeFsFor(env)

  const run = async (): Promise<FileEntryResponse> => {
    // Pick a candidate before acquiring ALL relevant path locks in their global
    // sorted order. If a copy candidate became occupied, release and retry the next
    // name; never nest a late candidate lock under already-held locks (deadlock).
    let name = baseName
    for (let i = 0; i < 1000; i++) {
      const candidate = path.join(destDir, name)
      const result = await withPathLocks(
        workspaceLockPaths(dir, [source, candidate]),
        async (): Promise<FileEntryResponse | { collisionIsFolder: boolean }> => {
          // Revalidate source and destination only after their locks are held.
          const isFolder = (await requireKind(tree, source)) === 'dir'
          if (!(await tree.isDir(destDir)))
            throw new ApiError(404, 'not_a_directory', `${destDir} is not a directory`)
          assertNotIntoSelf(source, destDir, isFolder)

          // Same-directory move is a no-op (paste-cut back where it came from).
          if (mode === 'move' && path.dirname(source) === destDir)
            return { path: source, type: isFolder ? 'dir' : 'file' }

          if (await tree.exists(candidate)) {
            if (mode === 'move')
              throw new ApiError(409, 'already_exists', 'A file with that name already exists')
            return { collisionIsFolder: isFolder }
          }

          await attempt('paste_failed', `Could not ${mode} ${source}`, () =>
            mode === 'move' ? tree.move(source, candidate) : tree.copy(source, candidate),
          )
          if (mode === 'move') {
            recordFileOp(sessionId, {
              kind: 'move',
              workspaceRoot: dir,
              from: source,
              to: candidate,
              entryType: isFolder ? 'dir' : 'file',
            })
          }
          return { path: candidate, type: isFolder ? 'dir' : 'file' }
        },
      )
      if ('path' in result) return result
      name = incrementName(name, result.collisionIsFolder)
    }
    throw new ApiError(500, 'paste_failed', 'Too many duplicate names')
  }

  return mode === 'move' ? withFileOpJournalLock(sessionId, run) : run()
}

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
 * Duplicate a tree entry in place — copy it into its OWN parent directory with an
 * auto-incremented name ({@link incrementName}). Thin wrapper over the copy path of
 * {@link pasteEntry} (destDir = the source's parent), so the collision/guard logic
 * is shared. Backend-agnostic via {@link treeFsFor}.
 */
export async function duplicateEntry(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  targetPath: string,
): Promise<FileEntryResponse> {
  // Resolve source and destination together inside pasteEntry's single session-env
  // snapshot. Opening the session twice could span a directory change and duplicate
  // an absolute source from the old root into a destination derived from the new one.
  return pasteEntry(ctx, userId, sessionId, targetPath, path.dirname(targetPath), 'copy')
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

/**
 * Reveal a tree entry in the host OS file manager (Finder/Explorer/xdg). Only
 * meaningful for a LOCAL-backend session — the resolved path is a remote path for
 * ssh/docker, so we refuse those rather than reveal a non-existent local path.
 */
export async function revealEntry(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  targetPath: string,
): Promise<{ opened: true }> {
  const { session, dir } = await openSessionEnv(ctx, userId, sessionId)
  if (session.executionBackend && session.executionBackend !== 'local')
    throw new ApiError(400, 'reveal_unsupported', 'Reveal is only available for local sessions')
  return revealPath(resolveAgainst(dir, targetPath))
}
