/**
 * Per-session, in-memory journal of reversible file-tree mutations — the backing
 * store for the file-tree Undo (⌘Z). Deliberately NOT persisted: undo is a
 * live-session ergonomic (recover from a mistaken delete/move/rename you just
 * made), not durable history. Bounded to the last {@link MAX_OPS} ops per session
 * so it can't grow without limit over a long session.
 */
import { createKeyedSerializer } from '../../../lib/keyed-serializer'

/** A single reversible file operation recorded for undo. */
export type FileOp =
  /** A delete that moved the entry to the trash instead of removing it. */
  | {
      kind: 'trash'
      workspaceRoot: string
      original: string
      trashPath: string
      entryType: 'file' | 'dir'
    }
  /** A move/rename/paste-move: the entry travelled from `from` to `to`. */
  | {
      kind: 'move'
      workspaceRoot: string
      from: string
      to: string
      entryType: 'file' | 'dir'
    }

const MAX_OPS = 20

/** sessionId → newest-last stack of reversible ops (capped at {@link MAX_OPS}). */
const journals = new Map<string, FileOp[]>()
const serializeJournal = createKeyedSerializer()

/**
 * Serialize a reversible filesystem mutation together with its journal update.
 * Without this boundary an Undo issued while a rename/delete was between its disk
 * commit and `recordFileOp` could report "nothing to undo", or pop the wrong op.
 */
export function withFileOpJournalLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  return serializeJournal(sessionId, fn)
}

/** Record a reversible op onto a session's journal, evicting the oldest past the cap. */
export function recordFileOp(sessionId: string, op: FileOp): void {
  const stack = journals.get(sessionId) ?? []
  stack.push(op)
  while (stack.length > MAX_OPS) stack.shift()
  journals.set(sessionId, stack)
}

/** Remove and return the most recent op for a session (undo consumes it). */
export function popLastFileOp(sessionId: string): FileOp | undefined {
  const stack = journals.get(sessionId)
  if (!stack || stack.length === 0) return undefined
  const op = stack.pop()
  if (stack.length === 0) journals.delete(sessionId)
  return op
}

/** Drop a session's whole journal (e.g. on session close). */
export function clearFileOpJournal(sessionId: string): void {
  journals.delete(sessionId)
}
