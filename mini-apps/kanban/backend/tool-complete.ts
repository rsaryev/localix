import type { KanbanTask } from '../shared/contracts'
import { epicFinishedBy, unblockedBy } from './describe'
import type { KanbanToolDetails } from '../shared/tool'
import type { BoardChat, BoardService } from './service'
import { openItemsNotice } from './tool-input'

type Result = { content: string; details?: KanbanToolDetails }

/**
 * `complete`: the card goes to done. A done card
 * stays done without a write, and `itemsDone` ticks the whole checklist on the way, so finishing a
 * card is one call instead of tick-then-complete-again.
 */
export async function completeCard(
  boards: BoardService,
  chat: BoardChat,
  task: KanbanTask,
  itemsDone: boolean,
): Promise<Result> {
  const done = (content: string, written: KanbanTask): Result => ({
    content,
    details: { sessionId: chat.sessionId, task: written },
  })
  if (task.status === 'done') return done(`${task.id} is already done; nothing changed.`, task)
  if (itemsDone && task.subtasks.some((item) => !item.done))
    await boards.update(
      chat,
      task.id,
      { subtasks: task.subtasks.map((item) => ({ ...item, done: true })) },
      'agent',
    )
  const written = await boards.update(chat, task.id, { status: 'done', error: null }, 'agent')
  const after = (await boards.read(chat)).tasks
  const released = unblockedBy(after, task.id)
  const notice = released.length
    ? ` Now unblocked: ${released.map((card) => `${card.id} (@${card.assignee ?? 'unassigned'})`).join(', ')}.`
    : ''
  const epic = epicFinishedBy(after, task.id)
  const epicNotice = epic
    ? ` Every task of epic ${epic.id} is finished; complete it too when its goal is met.`
    : ''
  return done(
    `Completed ${task.id}.${openItemsNotice(written.subtasks)}${notice}${epicNotice}`,
    written,
  )
}
