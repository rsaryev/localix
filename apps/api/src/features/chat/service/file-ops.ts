/**
 * The session file-browser surface, as one facade over three independent families:
 *
 *   - `file-content.ts`   read / write / list — the inspector viewer + editor
 *   - `file-tree-ops.ts`  create / rename / paste / delete / duplicate / undo / reveal
 *   - `file-search.ts`    file-name search, content search, search-and-replace
 *
 * They share only the per-op preamble in `file-ops-context.ts` (session → execution
 * environment → working dir). Callers (`service.ts`, `routes-types.ts`) import this
 * module, so the split stays an implementation detail.
 */
export type { FileOpsContext } from './file-ops-context'

export { readFile, writeFile, listDirectory } from './file-content'

import * as treeOps from './file-tree-ops'
import { invalidateFileList } from './file-list-cache'

export { revealEntry, incrementName } from './file-tree-ops'

/**
 * Every tree MUTATION adds or removes a path, which makes the memoized `rg --files`
 * list behind quick-open wrong. The fs-watch feed would invalidate it too, but only
 * for a local session whose tree someone has open — and a user who just created a
 * file expects ⌘P to find it on the next keystroke, not after the backstop TTL. The
 * whole memo is dropped rather than one root's: it holds a handful of entries and
 * refills in a single walk, so precision buys nothing here.
 */
function invalidatingFileList<A extends unknown[], R>(
  op: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await op(...args)
    } finally {
      invalidateFileList()
    }
  }
}

export const createEntry = invalidatingFileList(treeOps.createEntry)
export const renameEntry = invalidatingFileList(treeOps.renameEntry)
export const pasteEntry = invalidatingFileList(treeOps.pasteEntry)
export const deleteEntry = invalidatingFileList(treeOps.deleteEntry)
export const duplicateEntry = invalidatingFileList(treeOps.duplicateEntry)
export const undoLastFileOp = invalidatingFileList(treeOps.undoLastFileOp)

export { findFiles, searchContent, replaceContent, searchPaths, deriveFolders } from './file-search'
export type { FindFilesOptions, ContentSearchOptions, ReplaceContentResult } from './file-search'
