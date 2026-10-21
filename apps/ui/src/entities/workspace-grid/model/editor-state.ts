import type { WorkItem } from '@/shared/lib/workItem'
import type { GridNode } from './tree'
import type { ClosedTab } from './tab-history'

export interface EditorState {
  root: GridNode
  items: Record<string, WorkItem>
  activeGroup: string
  /** Group ids, most-recently-active first. */
  mru: string[]
  maximizedGroup: string | null
  /** Most-recently-closed tabs (newest last), capped at MAX_CLOSED. */
  closed: ClosedTab[]
}

export interface OpenOptions {
  /** Target group; defaults to the active group. */
  group?: string
  /** Make the item active (steal focus). Default true. */
  activate?: boolean
  /** Open into the group's shared preview slot (agent auto-open). */
  ephemeral?: boolean
  /** Single-click preview for file-tree click-through: reuse the target
   *  group's ACTIVE tab slot (a non-dirty path-backed file/diff) instead of piling a
   *  new tab — the clicked file takes over that slot. Falls back to a normal open
   *  when the active tab is dirty, not path-backed, or absent. Ignored once an
   *  existing/twin tab for the same document is found (that reveal wins). */
  replace?: boolean
}
