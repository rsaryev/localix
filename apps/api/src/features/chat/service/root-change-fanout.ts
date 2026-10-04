import type { FsChange } from '../../fs-watch/watcher'
import type { LspManager } from '../../lsp'
import { invalidateFileList } from './file-list-cache'

/**
 * What a settled change under a watched session root means to the chat host's other owners —
 * the `onRootChanged` the file watch service is given (it stays agnostic about who listens).
 *
 * 1. Quick-open's memoized `rg --files` list is stale: an agent write, a build, a branch
 *    switch. Cheaper and more accurate than waiting out the memo's backstop TTL.
 * 2. The root's language servers must hear it. They were told only about the agent's own
 *    writes, so a terminal edit or a branch switch left them answering from files that no
 *    longer existed. The watch root IS the LSP project root (both are the session's
 *    `resolveSessionWorkingDir`). Unknown changes (`null`: an overflowing burst, a failed
 *    watcher) are not guessed at — a server's own startup read is the only full rescan there is.
 */
export function rootChangeFanout(lspManager: Pick<LspManager, 'notifyWatchedFiles'> | undefined) {
  return (root: string, changes: FsChange[] | null): void => {
    invalidateFileList(root)
    if (changes?.length) void lspManager?.notifyWatchedFiles(root, changes).catch(() => {})
  }
}
