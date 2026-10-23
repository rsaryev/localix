import type { KanbanTask } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import { epicFinishedBy, unblockedBy } from './describe'
import type { KanbanToolDetails } from '../shared/tool'
import type { BoardSeat, BoardService } from './service'
import { openItemsNotice } from './tool-input'

type Result = { content: string; details?: KanbanToolDetails }

/**
 * `complete`: a member's card goes to review, the leader's (or a lone agent's) to done. A done card
 * stays done without a write, and `itemsDone` ticks the whole checklist on the way, so finishing a
 * card is one call instead of tick-then-complete-again.
 */
export async function completeCard(
  boards: BoardService,
  seat: BoardSeat,
  task: KanbanTask,
  leads: boolean,
  itemsDone: boolean,
  /** Whom a member's card waits on: "@localix (the leader)" or "the leader". */
  leader = 'the leader',
): Promise<Result> {
  const done = (content: string, written: KanbanTask): Result => ({
    content,
    details: { sessionId: seat.sessionId, task: written },
  })
  if (task.status === 'done') return done(`${task.id} is already done; nothing changed.`, task)
  // A member re-completing its card in review would re-send it; the verification is the leader's.
  if (!leads && task.status === 'review')
    return done(
      `${task.id} is already in review; ${leader.replace(' (the leader)', '')} verifies it. Nothing to do until then.`,
      task,
    )
  if (itemsDone && task.subtasks.some((item) => !item.done))
    await boards.update(
      seat,
      task.id,
      { subtasks: task.subtasks.map((item) => ({ ...item, done: true })) },
      'agent',
    )
  if (!leads) {
    const open = itemsDone ? [] : task.subtasks.filter((item) => !item.done)
    if (open.length)
      throw new BoardRefusal(
        409,
        'open_items',
        `${task.id} still has unticked checklist items: ${open.map((item) => `"${item.text}"`).join(', ')}. If all are finished, complete with items_done: true; otherwise tick what you finished with update items, or block the card with what is left.`,
      )
    const sent = await boards.update(seat, task.id, { status: 'review', error: null }, 'agent')
    return done(
      `Sent ${task.id} to review; ${leader} will verify it.${openItemsNotice(sent.subtasks)}`,
      sent,
    )
  }
  const written = await boards.update(seat, task.id, { status: 'done', error: null }, 'agent')
  const after = (await boards.read(seat)).tasks
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
