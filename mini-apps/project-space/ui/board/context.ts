import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Side } from '../../shared/format/schema'
import type { SpaceOp } from '../../shared/ops/contract'

/**
 * What a node needs from the board it is on: how to change the board, the chat the tab belongs
 * to (the key to every file route), and two FLAGS — which element is being edited in place, and
 * which one is selected alone (it offers quick create).
 *
 * The actions are stable for the board's life and travel by context. The flags change on every
 * click, and a context value that changes re-renders every node that reads it — selecting one
 * note redrew the whole board. So the flags live in a small store, and a node subscribes to the
 * one answer it needs ("am I being edited?"), which changes for two nodes at most.
 */
export interface BoardFlags {
  editing: string | null
  /** The element selected on its own, or null. */
  single: string | null
}

export interface BoardFlagStore {
  get(): BoardFlags
  set(next: BoardFlags): void
  subscribe(this: void, listener: () => void): () => void
}

export function createFlagStore(): BoardFlagStore {
  let flags: BoardFlags = { editing: null, single: null }
  const listeners = new Set<() => void>()
  return {
    get: () => flags,
    set(next) {
      if (next.editing === flags.editing && next.single === flags.single) return
      flags = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export interface BoardActions {
  sessionId: string
  apply: (ops: readonly SpaceOp[]) => void
  setEditing: (id: string | null) => void
  /** Interaction inside a nested widget still selects and frames its card. */
  focus: (id: string) => void
  /** Add a connected twin of an element on one side. */
  grow: (id: string, side: Side) => void
  flags: BoardFlagStore
}

export const BoardContext = createContext<BoardActions | null>(null)

export function useBoard(): BoardActions {
  const board = useContext(BoardContext)
  if (!board) throw new Error('an element node rendered outside its board')
  return board
}

/** One yes-or-no about this node, re-rendering it only when that answer changes. */
export function useBoardFlag(pick: (flags: BoardFlags) => boolean): boolean {
  const { flags } = useBoard()
  return useSyncExternalStore(flags.subscribe, () => pick(flags.get()))
}
