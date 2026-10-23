import type { ChangeFeedHost, CoreDeletion } from '@localixai/mini-app-sdk/backend'

import type { BoardEvent, KanbanBoard } from '../shared/contracts'
import { openBoardStore } from './store'

type SessionDirs = () => Promise<readonly { sessionId: string; dir: string }[]>

/** Cards of `agentId` lose their assignee; every other card is left as it is. */
export function unassignAgent(board: KanbanBoard, agentId: string, sessionId: string, now: string) {
  const events: BoardEvent[] = []
  const tasks = board.tasks.map((task) => {
    if (task.agentId !== agentId) return task
    const next = { ...task, agentId: null, assignee: null, updatedAt: now }
    events.push({ type: 'task.updated', sessionId, task: next })
    return next
  })
  return { board: events.length ? { ...board, tasks } : board, events, result: events.length }
}

/**
 * A deleted agent no longer owns a card on any board: its cards go back to unassigned, so no card
 * names an agent nothing can run or address. A renamed agent keeps its cards (the host passes on
 * only real deletions, and a card stores the stable id). Returns the cards released.
 */
export async function releaseDeletedAgent(
  listDirs: SessionDirs,
  agentId: string,
  now = () => new Date().toISOString(),
): Promise<number> {
  let released = 0
  for (const { sessionId, dir } of await listDirs()) {
    const store = openBoardStore(dir)
    const board = await store.read()
    if (!board.tasks.some((task) => task.agentId === agentId)) continue
    released += await store.update((current) => unassignAgent(current, agentId, sessionId, now()))
  }
  return released
}

/** Follow the core's agent deletions; resolves with the stop (or null on a host without either). */
export async function followAgentDeletions(
  changes: ChangeFeedHost | undefined,
  listDirs: SessionDirs | undefined,
): Promise<(() => Promise<void>) | null> {
  if (!changes || !listDirs) return null
  return changes.followCoreDeletions('unassign-deleted-agents', async (deletion: CoreDeletion) => {
    if (deletion.entity === 'agent' && deletion.ref.agentId)
      await releaseDeletedAgent(listDirs, deletion.ref.agentId)
  })
}
