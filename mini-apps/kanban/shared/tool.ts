import type { UiNavigationAction } from '@localixai/mini-app-sdk/ui'

import type { KanbanTask } from './contracts'

/** The tool's name and action vocabulary, shared by the tool and its transcript card. */
export const KANBAN_TOOL = 'kanban'

export const KANBAN_ACTIONS = [
  'list',
  'search',
  'create',
  'update',
  'take',
  'complete',
  'block',
  'reorder',
  'delete',
  'detail',
] as const
export type KanbanAction = (typeof KANBAN_ACTIONS)[number]

/**
 * The slice of a card the transcript card shows. A list ships this, not full cards: the model
 * reads the text result, and full cards (descriptions, checklists, artifacts) would be persisted
 * and streamed for every board render only for the card to ignore them.
 */
export type KanbanCardTask = Pick<
  KanbanTask,
  'id' | 'title' | 'status' | 'kind' | 'assignee' | 'priority'
> & { subtasks?: { done: boolean }[] }

export const slimTask = (task: KanbanTask): KanbanCardTask => ({
  id: task.id,
  title: task.title,
  status: task.status,
  kind: task.kind,
  assignee: task.assignee,
  priority: task.priority,
  ...(task.subtasks.length ? { subtasks: task.subtasks.map((item) => ({ done: item.done })) } : {}),
})

export interface KanbanToolDetails {
  /** The chat whose board the call acted on — what the card's links open. */
  sessionId: string
  task?: KanbanTask
  tasks?: KanbanCardTask[]
  /** The board, offered after the agent put new work on it; the agent links it when the person should see it. */
  reveal?: UiNavigationAction
}
