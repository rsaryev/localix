import { isTextItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../db'
import type { PersistedMessage } from '../contracts'

/** A message-tree node as returned by `repo.listMessageNodes`. */
export type MessageTreeNode = { message: PersistedMessage; parentId: string | null }

/**
 * Build the two lookup maps every tree walk needs from `listMessageNodes`:
 * `parentById` (id → parent id, for `walkPathToRoot`) and `msgById` (id →
 * message). Both are derived from one pass over the nodes.
 */
export function indexMessageTree(nodes: readonly MessageTreeNode[]): {
  parentById: Map<string, string | null>
  msgById: Map<string, PersistedMessage>
} {
  const parentById = new Map<string, string | null>()
  const msgById = new Map<string, PersistedMessage>()
  for (const n of nodes) {
    parentById.set(n.message.id, n.parentId)
    msgById.set(n.message.id, n.message)
  }
  return { parentById, msgById }
}

/**
 * Walk a message tree from `start` up to the root via `parentById`, returning the
 * path in chronological (root-first) order. A node is only followed while it is a
 * known node (a key of `parentById`) and not already visited, so a malformed cycle
 * terminates instead of looping forever.
 */
export function walkPathToRoot(
  parentById: Map<string, string | null>,
  start: string | null,
): string[] {
  const path: string[] = []
  const guard = new Set<string>()
  let cursor: string | null = start
  while (cursor !== null && parentById.has(cursor) && !guard.has(cursor)) {
    guard.add(cursor)
    path.push(cursor)
    cursor = parentById.get(cursor) ?? null
  }
  path.reverse()
  return path
}

export function previewBranchPayload(payload: StoredMessagePayload): string {
  const text =
    typeof payload.content === 'string' && payload.content
      ? payload.content
      : (payload.items ?? []).flatMap((it) => (isTextItem(it) ? [it.text] : [])).join(' ')
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine
}
