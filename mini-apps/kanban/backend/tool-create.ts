import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'

import type { KanbanTask } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import { boardUri } from '../shared/resource'
import { slimTask, type KanbanToolDetails } from '../shared/tool'
import { resolveDependencies, resolveTaskReference } from './describe'
import type { BoardChat, BoardService } from './service'
import { reviseChecklist, type ChecklistEntry } from './tool-input'

/** One card the `create` action puts on the board. */
export interface CreateEntry {
  title: string
  description?: string
  agent?: string
  kind?: 'epic' | 'task'
  parent?: string
  depends_on?: string[]
  priority?: number
  items?: ChecklistEntry[]
}

export type CreateInput = Omit<CreateEntry, 'title'> & {
  title?: string
  creates?: CreateEntry[]
}

type CreateResult = { content: string; details?: KanbanToolDetails }

/**
 * `create`: one card, or an ordered batch, each landing in backlog.
 */
export async function createCards(
  ctx: MiniAppContext,
  boards: BoardService,
  chat: BoardChat,
  input: CreateInput,
): Promise<CreateResult> {
  // A batch is the whole request: a card described beside `creates` was silently dropped (an
  // epic written next to its tasks never existed, and the tasks came out without a parent).
  const beside = (
    ['title', 'description', 'agent', 'kind', 'parent', 'depends_on', 'priority', 'items'] as const
  ).filter((field) => input[field] !== undefined)
  if (input.creates?.length && beside.length)
    throw new BoardRefusal(
      400,
      'mixed_create',
      `create got ${beside.join(', ')} beside creates. Put every card in creates, the epic first: [{ title, kind: "epic" }, { title, parent: "<epic title>" }, …].`,
    )
  const entries = input.creates?.length ? input.creates : [{ ...input, title: input.title ?? '' }]
  const created: KanbanTask[] = []
  let refused: string | null = null
  for (const [index, entry] of entries.entries()) {
    try {
      if (!entry.title.trim())
        throw new BoardRefusal(400, 'title_required', 'create requires title.')
      if (entry.kind === 'epic' && entry.items?.length)
        throw new BoardRefusal(
          400,
          'epic_items',
          'An epic holds no checklist: its tasks are its checklist. Put the items on its tasks.',
        )
      const tasks = (await boards.read(chat)).tasks
      const parent = entry.parent ? resolveTaskReference(tasks, entry.parent) : null
      created.push(
        await boards.create(
          chat,
          {
            title: entry.title,
            description: entry.description ?? '',
            kind: entry.kind ?? 'task',
            parentTaskId: parent?.id ?? null,
            ...(entry.agent ? { agent: entry.agent } : {}),
            ...(entry.depends_on
              ? { dependsOn: resolveDependencies(tasks, entry.depends_on) }
              : {}),
            ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
            ...(entry.items ? { subtasks: reviseChecklist([], entry.items) } : {}),
          },
          'agent',
        ),
      )
    } catch (error) {
      // The entries before this one are on the board already. Refusing the call whole reported
      // none of them, so the retry that fixed entry 3 created entries 1 and 2 a second time.
      // A refusal before anything was created is still the call's own failure.
      if (!(error instanceof BoardRefusal) || created.length === 0) throw error
      refused = `Entry ${index + 1} was not created: ${error.message} The entries above are on the board; do not create them again.`
      break
    }
  }
  return {
    content: [
      ...created.map((task) => `Created ${task.id} "${task.title}" in backlog.`),
      ...(refused ? [refused] : []),
    ].join('\n'),
    details: {
      sessionId: chat.sessionId,
      ...(created.length === 1 ? { task: created[0]! } : { tasks: created.map(slimTask) }),
      reveal: ctx.ui.offer({
        uri: boardUri(chat.sessionId),
        label: 'Open board',
        description: 'This chat’s board',
      }),
    },
  }
}
