import path from 'node:path'

import { FILE_CHANGE_CHANGED, FILE_CHANGE_CREATED, type LspClientInfo } from './lsp-protocol'
import type { LspServerStatus } from './lsp-manager-types'

/**
 * Changes to files ON DISK that no client of ours made: a terminal edit, a build, a branch
 * switch, a formatter run outside the agent.
 *
 * Before this, `workspace/didChangeWatchedFiles` was only ever sent for the agent's own writes
 * (`syncDocument` with `diskChanged`), so a language server kept answering from its picture of
 * files it was never told had changed: an import of a file created in the terminal stayed red,
 * a branch switch left go-to-definition pointing at deleted code. The workspace file watcher
 * (`features/fs-watch`) now reports every change under a session's root, and this is where its
 * entries become the notification each running server of that root receives.
 */

/** One changed entry in the watcher's vocabulary; mapped to the LSP `FileChangeType` below. */
export interface LspWatchedFileChange {
  path: string
  type: 'create' | 'update' | 'delete'
}

/** LSP `FileChangeType.Deleted` (Created = 1 and Changed = 2 live in `lsp-protocol.ts`). */
const FILE_CHANGE_DELETED = 3

export const WATCHED_CHANGE_CODE: Record<LspWatchedFileChange['type'], number> = {
  create: FILE_CHANGE_CREATED,
  update: FILE_CHANGE_CHANGED,
  delete: FILE_CHANGE_DELETED,
}

const VCS_SEGMENT = /[\\/]\.(git|hg|svn)([\\/]|$)/
/**
 * Dependency and build-cache trees. We advertise no `didChangeWatchedFiles` registration, so no
 * server ever narrowed what it hears: a `cargo build` writing thousands of files under `target/`,
 * `tsc --watch` and dev staging under `.turbo/`, an install under `node_modules/` all became up to
 * 1024 entries per 250ms flush to every server of the root — a language server re-processing a
 * build's output for as long as the build ran. None of these trees is source a server is asked
 * about, and the servers that care about installed packages watch them on their own.
 */
const BUILD_SEGMENT = /[\\/](node_modules|target|\.turbo|\.next)([\\/]|$)/

/** The structural slice of the manager's per-server record this needs. */
interface WatchedFilesTarget {
  client: LspClientInfo | null
  status: LspServerStatus
  rootDir: string
}

/**
 * Fan the changes out to every READY server of one project root, each receiving only what lies
 * under its own `rootDir` (a monorepo runs one server per package). A server still starting is
 * skipped: it reads the disk as it is when it initializes. Version-control internals are dropped
 * here — a branch switch rewrites `.git/` wholesale, and no language server watches it.
 */
export async function notifyWatchedFiles(
  targets: Iterable<WatchedFilesTarget> | undefined,
  changes: readonly LspWatchedFileChange[],
): Promise<void> {
  const relevant = changes.filter(
    (change) => !VCS_SEGMENT.test(change.path) && !BUILD_SEGMENT.test(change.path),
  )
  if (!targets || !relevant.length) return
  const sends: Promise<void>[] = []
  for (const target of targets) {
    if (!target.client || target.status !== 'ready') continue
    const prefix = target.rootDir.endsWith(path.sep) ? target.rootDir : target.rootDir + path.sep
    const own = relevant.filter((c) => c.path === target.rootDir || c.path.startsWith(prefix))
    if (own.length) sends.push(target.client.notifyWatchedFiles(own).catch(() => {}))
  }
  await Promise.all(sends)
}
