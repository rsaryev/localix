import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'

import {
  EMPTY_BOARD,
  kanbanBoardSchema,
  type BoardEvent,
  type KanbanBoard,
} from '../shared/contracts'

/**
 * One chat's board on disk, and the one place its writes are ordered and announced.
 *
 * Three failures shape it:
 *
 * - The host calls `register(ctx)` for the backend AND again for every run's tools, and each run
 *   imports this module afresh. A queue or listener set held by one load is invisible to the
 *   others, so the agent's writes would interleave with the person's drag and never reach the
 *   open board. Both live on `globalThis`, keyed by the board's file.
 * - Two read-modify-writes that interleave lose one of them. Every change for a file runs behind
 *   the previous one, so an operation sees the board the last write left.
 * - A crash halfway through a write would leave a board that never parses again. It is written
 *   atomically (`atomicWriteFile`); a file that does not parse reads as an empty board rather than
 *   throwing at every read.
 *
 * Events are published only after the write that caused them landed, so a view never shows a
 * card the disk does not have.
 */

const FILE = 'board.json'

interface Slot {
  queue: Promise<unknown>
  listeners: Set<(event: BoardEvent) => void>
}

const GLOBAL_KEY = Symbol.for('localix.mini-app.kanban.boards')

function slotFor(path: string): Slot {
  const g = globalThis as { [key: symbol]: Map<string, Slot> | undefined }
  const slots = (g[GLOBAL_KEY] ??= new Map())
  let slot = slots.get(path)
  if (!slot) {
    slot = { queue: Promise.resolve(), listeners: new Set() }
    slots.set(path, slot)
  }
  return slot
}

async function load(path: string): Promise<KanbanBoard> {
  try {
    const parsed = kanbanBoardSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data : EMPTY_BOARD
  } catch {
    return EMPTY_BOARD
  }
}

const save = (path: string, board: KanbanBoard) =>
  atomicWriteFile(path, `${JSON.stringify(board, null, 2)}\n`)

export interface BoardStore {
  read(): Promise<KanbanBoard>
  /**
   * Apply `change` to the current board and persist what it returns. A throw writes nothing and
   * rejects with the throw; the events are announced once the board is on disk.
   */
  update<T>(
    change: (board: KanbanBoard) => { board: KanbanBoard; events: BoardEvent[]; result: T },
  ): Promise<T>
  subscribe(listener: (event: BoardEvent) => void): () => void
}

export function openBoardStore(dir: string): BoardStore {
  const path = join(dir, FILE)
  const slot = slotFor(path)
  const behind = <T>(work: () => Promise<T>): Promise<T> => {
    const next = slot.queue.then(work)
    slot.queue = next.catch(() => undefined)
    return next
  }
  return {
    // Behind the queue, so a read never returns the board a pending write is about to replace.
    read: () => behind(() => load(path)),
    update: (change) =>
      behind(async () => {
        const { board, events, result } = change(await load(path))
        await save(path, kanbanBoardSchema.parse(board))
        for (const event of events)
          for (const listener of Array.from(slot.listeners)) {
            try {
              listener(event)
            } catch {
              /* one bad subscriber never breaks the board */
            }
          }
        return result
      }),
    subscribe(listener) {
      slot.listeners.add(listener)
      return () => {
        slot.listeners.delete(listener)
      }
    },
  }
}
