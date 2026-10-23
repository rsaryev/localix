import {
  bestFieldScore,
  type ResourceNode,
  type ResourceRefProvider,
  type SearchHit,
  type SearchProvider,
} from '@localixai/mini-app-sdk/backend'

import type { KanbanTask } from '../shared/contracts'
import { parseKanbanUri, SEARCH_PROVIDER_ID, taskUri } from '../shared/resource'
import { describeBoard, taskBrief } from './describe'
import type { BoardService } from './service'

/**
 * How the rest of the product reaches a card without knowing what a board is: the composer's
 * `@resource:` picker and a dragged card (a resource provider), and global search (a search
 * provider). Both answer for ONE chat's board — the session the request names — because a board
 * belongs to its chat and nothing reads across chats.
 */

const PROVIDER = 'kanban'
const ICON = 'kanban'

const cardNode = (sessionId: string, task: KanbanTask, hasChildren: boolean): ResourceNode => ({
  uri: taskUri(sessionId, task.id),
  label: `${task.id} ${task.title}`,
  detail: task.status.replace('_', ' '),
  hasChildren,
  icon: ICON,
})

export function createBoardResourceProvider(boards: BoardService): ResourceRefProvider {
  const read = async (userId: string, sessionId: string) =>
    (await boards.read({ userId, sessionId }).catch(() => null))?.tasks ?? []

  return {
    provider: PROVIDER,
    title: 'Board',
    async listChildren(userId, parentUri, query, scope) {
      const address = parentUri ? parseKanbanUri(parentUri) : null
      const sessionId = address?.sessionId ?? scope?.sessionId
      if (!sessionId) return []
      const tasks = await read(userId, sessionId)
      const parent = address?.kind === 'task' ? address.taskId : null
      const needle = query?.trim().toLowerCase() ?? ''
      return tasks
        .filter((task) => (parent ? task.parentTaskId === parent : !task.parentTaskId))
        .filter((task) => !needle || `${task.id} ${task.title}`.toLowerCase().includes(needle))
        .map((task) =>
          cardNode(
            sessionId,
            task,
            tasks.some((child) => child.parentTaskId === task.id),
          ),
        )
    },
    async expand(userId, uri) {
      const address = parseKanbanUri(uri)
      if (!address?.sessionId) return { ok: false, error: 'That is not a board card.' }
      const board = await boards.read({ userId, sessionId: address.sessionId }).catch(() => null)
      if (!board) return { ok: false, error: 'That board belongs to a chat that is not available.' }
      if (address.kind === 'board')
        return { ok: true, content: describeBoard(board.tasks) || 'The board is empty.' }
      const task = board.tasks.find((candidate) => candidate.id === address.taskId)
      if (!task) return { ok: false, error: `${address.taskId} is no longer on the board.` }
      return {
        ok: true,
        content: `${taskBrief(task, board)}\n\nStatus: ${task.status}. Read or change it with the kanban tool.`,
      }
    },
  }
}

export function createBoardSearchProvider(boards: BoardService): SearchProvider {
  return {
    id: SEARCH_PROVIDER_ID,
    title: 'Tasks',
    tier: 'eager',
    icon: ICON,
    async search(userId, query) {
      if (!query.sessionId) return []
      const sessionId = query.sessionId
      const tasks = (await boards.read({ userId, sessionId }).catch(() => null))?.tasks ?? []
      const hits: SearchHit[] = []
      for (const task of tasks) {
        const score = bestFieldScore([task.title, task.description, task.id], query.text)
        if (score <= 0) continue
        hits.push({
          id: taskUri(sessionId, task.id),
          domain: SEARCH_PROVIDER_ID,
          title: task.title,
          subtitle: task.id,
          icon: ICON,
          score,
        })
      }
      return hits
    },
  }
}
