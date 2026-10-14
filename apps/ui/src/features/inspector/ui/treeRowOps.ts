import type { DirEntry } from '@/shared/api/contracts'
import { CMD, matchesChord } from '@/shared/lib/keybindings'
import type { PendingDelete, TreeClipboard } from './useFileTree'

/** A row of the tree, as every operation below identifies it. */
export type TreeRow = PendingDelete

/**
 * The set of operations ANY tree row supports — the vocabulary of "what can I do to
 * this entry". Folders and files differ only in what they add ON TOP (a folder can be
 * created into; a file can be opened and compared), never in this shared core, so it
 * lives in one place and both rows consume it.
 *
 * Before this existed the two rows each re-stated all thirteen items and all six
 * keybindings, so adding one operation meant editing the menu twice and the key handler
 * twice. The single real difference between them ("Copy name", offered only on a file)
 * is now a parameter rather than a reason to keep two copies.
 */
export interface TreeRowOps {
  startRename: (entry: DirEntry, parentPath: string) => void
  duplicate: (row: TreeRow) => void | Promise<unknown>
  clip: (row: TreeRow, mode: 'cut' | 'copy') => void
  pasteInto: (destDir: string) => void | Promise<unknown>
  reveal: (path: string) => void
  /**
   * Add the entry to whatever ignore list the tree's decoration provider owns, and what to call
   * that in the menu. Absent when no provider offers one — the tree has no ignore list of its own,
   * so the item simply is not there rather than failing when chosen.
   */
  addToIgnore?: (path: string, isDir: boolean) => void
  ignoreLabel?: string
  requestDelete: (row: TreeRow, permanent?: boolean) => void
  undoLast: () => void | Promise<unknown>
  /** Copy + report. `label` names what was copied, e.g. "Path" -> "Path copied". */
  copyText: (text: string, label: string) => void
  clipboard: TreeClipboard | null
  /** Selected paths — drives the "Delete N items" label when this row is part of a set. */
  selected: ReadonlySet<string>
  /** Project root, for "Copy relative path". */
  root: string | null
}

/** What identifies the row an operation acts on. A compact (folded) folder row acts on
 *  its TAIL folder, which is why `entry`/`parentPath` are passed rather than derived. */
export interface TreeRowTarget {
  row: TreeRow
  entry: DirEntry
  parentPath: string
  /** Where a Paste lands: INTO a folder row, but into a file row's PARENT. */
  pasteTarget: string
}

/**
 * The keyboard bindings for a focused tree row — the same operations the context menu
 * offers, reachable without it. Shift+Delete deletes permanently (skips the trash).
 * Returns true when the key was claimed, so the caller can leave arrow-key navigation
 * (which is delegated at the container) alone.
 */
export function treeRowKeyDown(
  e: React.KeyboardEvent,
  matchesKey: (e: React.KeyboardEvent, commandId: string) => boolean,
  ops: TreeRowOps,
  target: TreeRowTarget,
): boolean {
  const { row, entry, parentPath, pasteTarget } = target
  if (matchesKey(e, CMD.renameFile)) ops.startRename(entry, parentPath)
  else if (matchesKey(e, CMD.deleteFile) || e.key === 'Backspace' || e.key === 'Delete') {
    ops.requestDelete(row, e.shiftKey)
  } else if (matchesChord(e, 'mod+z')) void ops.undoLast()
  else if (matchesKey(e, CMD.cutFile)) ops.clip(row, 'cut')
  else if (matchesKey(e, CMD.copyFile)) ops.clip(row, 'copy')
  else if (matchesKey(e, CMD.pasteFile)) void ops.pasteInto(pasteTarget)
  else return false
  e.preventDefault()
  return true
}
