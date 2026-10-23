import { enqueueMicrotask } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import type { BoardEvent, KanbanTask } from '../../shared/contracts'
import { boardApi } from '../api/board-client'
import { boardFeed } from '../api/board-stream'

/**
 * ONE live mirror per chat's board, shared by every surface that shows it.
 *
 * The board tab, the composer strip and each open task tab all want the same cards. A private
 * copy each meant one fetch and one stream per surface, and N components re-rendering on every
 * delta; so the mirror is module state keyed by session, refcounted rather than mounted, because
 * its readers live in trees (a grid tab, the composer) with no common ancestor.
 *
 * What makes the mirror TRUE, in order:
 *
 * 1. The first reader subscribes to the stream, THEN reads the board. Events that arrive while the
 *    read is in flight are kept and replayed over its answer — a card changed between the read
 *    and its response would otherwise be overwritten by the older read.
 * 2. Replay is safe because an upsert never regresses a card: `updatedAt` is the board's edit
 *    token and never goes back, so an event older than the card it would replace is dropped.
 * 3. A reconnect, or a reader returning after nobody was watching, reads the board again. The
 *    stream carries deltas only; whatever changed while no one listened never arrives over it.
 *    The cached cards keep painting meanwhile, so a reopened board never flashes a skeleton.
 */

export interface BoardState {
  tasks: KanbanTask[]
  /** Why the cards are missing or stale, when they are. `null` once a read has landed. */
  error: string | null
  /** True once the first read SETTLED, either way — `tasks: []` alone cannot say "empty". */
  settled: boolean
}

interface Entry {
  state: BoardState
  listeners: Set<() => void>
  releaseStream: (() => void) | null
  /** One list per read in flight: the events seen since it left, replayed over its answer. */
  inFlight: Set<BoardEvent[]>
  /** A first read is scheduled; a StrictMode re-subscribe must not schedule a second. */
  readQueued: boolean
}

const EMPTY: BoardState = Object.freeze({ tasks: [], error: null, settled: false }) as BoardState
const entries = new Map<string, Entry>()

/** Apply one board event: a delete drops the card, an upsert replaces it unless it is older. */
export function applyBoardEvent(tasks: KanbanTask[], event: BoardEvent): KanbanTask[] {
  if (event.type === 'task.deleted') {
    return tasks.some((task) => task.id === event.taskId)
      ? tasks.filter((task) => task.id !== event.taskId)
      : tasks
  }
  const index = tasks.findIndex((task) => task.id === event.task.id)
  if (index < 0) return [...tasks, event.task]
  if (tasks[index]!.updatedAt > event.task.updatedAt) return tasks
  const next = tasks.slice()
  next[index] = event.task
  return next
}

function entryOf(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (!entry) {
    entry = {
      state: EMPTY,
      listeners: new Set(),
      releaseStream: null,
      inFlight: new Set(),
      readQueued: false,
    }
    entries.set(sessionId, entry)
  }
  return entry
}

function publish(entry: Entry, next: BoardState): void {
  entry.state = next
  for (const listener of Array.from(entry.listeners)) listener()
}

export function getBoardState(sessionId: string): BoardState {
  return entries.get(sessionId)?.state ?? EMPTY
}

/** Replace the cached cards — the optimistic path a drag or a quick move writes through. */
export function setBoardTasks(
  sessionId: string,
  update: KanbanTask[] | ((prev: KanbanTask[]) => KanbanTask[]),
): void {
  const entry = entryOf(sessionId)
  const tasks = typeof update === 'function' ? update(entry.state.tasks) : update
  if (tasks !== entry.state.tasks) publish(entry, { ...entry.state, tasks })
}

/**
 * Show a card a write just answered with, without waiting for its stream echo — the same card the
 * echo will carry, so the two converge, and the `updatedAt` guard keeps an older echo out.
 */
export function acceptTask(sessionId: string, task: KanbanTask): void {
  setBoardTasks(sessionId, (prev) =>
    applyBoardEvent(prev, { type: 'task.updated', sessionId, task }),
  )
}

/** Read the board again: after a refused write, a reconnect, or a failed first read. */
export async function reconcileBoard(sessionId: string): Promise<void> {
  const entry = entryOf(sessionId)
  const pending: BoardEvent[] = []
  entry.inFlight.add(pending)
  try {
    const board = await boardApi.board(sessionId)
    const tasks = pending.reduce(applyBoardEvent, board.tasks)
    publish(entry, { tasks, error: null, settled: true })
  } catch (error) {
    publish(entry, {
      ...entry.state,
      error: errorMessage(error, 'The board could not be read.'),
      settled: true,
    })
  } finally {
    entry.inFlight.delete(pending)
  }
}

function onEvent(entry: Entry, event: BoardEvent): void {
  for (const pending of entry.inFlight) pending.push(event)
  const tasks = applyBoardEvent(entry.state.tasks, event)
  if (tasks !== entry.state.tasks) publish(entry, { ...entry.state, tasks })
}

/**
 * Watch one chat's board. The first watcher opens the stream and reads the board; the last one
 * closes the stream and KEEPS the cards, so the next watcher paints from them while it re-reads.
 */
export function subscribeBoard(sessionId: string, listener: () => void): () => void {
  const entry = entryOf(sessionId)
  entry.listeners.add(listener)
  if (entry.listeners.size === 1) {
    entry.releaseStream = boardFeed.follow(sessionId, {
      frame: (event) => onEvent(entry, event),
      reconnect: () => void reconcileBoard(sessionId),
    })
    // One microtask, so React's development StrictMode probe can release its throwaway
    // watcher before it reaches the network — and one read however often it re-subscribed.
    if (!entry.readQueued) {
      entry.readQueued = true
      enqueueMicrotask(() => {
        entry.readQueued = false
        if (entry.listeners.size > 0) void reconcileBoard(sessionId)
      })
    }
  }
  let released = false
  return () => {
    // StrictMode runs a cleanup twice; a second release would drop a watcher someone still owns.
    if (released) return
    released = true
    entry.listeners.delete(listener)
    if (entry.listeners.size > 0) return
    entry.releaseStream?.()
    entry.releaseStream = null
  }
}

/** Test seam: forget every cached board so one test's cards cannot leak into the next. */
export function resetBoardStore(): void {
  for (const entry of entries.values()) entry.releaseStream?.()
  entries.clear()
}
