import type { KanbanStatus, KanbanSubtask } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import type { KanbanAction } from '../shared/tool'

/**
 * What each action of the `kanban` tool reads from its one flat input.
 *
 * The defect this stops: one tool means one input object, so the schema offers every field to
 * every action, and an action quietly dropped the ones it had no use for. `update` with a new
 * checklist answered "Updated LX-4" and kept the old one; the model reported the edit as done.
 * A field the action does not read is now refused BY NAME, with the action that does read it.
 */
const READS: Record<KanbanAction, readonly string[]> = {
  list: [],
  search: ['query'],
  create: [
    'creates',
    'title',
    'description',
    'agent',
    'kind',
    'parent',
    'depends_on',
    'priority',
    'items',
  ],
  update: [
    'task_id',
    'title',
    'description',
    'agent',
    'parent',
    'status',
    'depends_on',
    'priority',
    'items',
  ],
  take: ['task_id'],
  complete: ['task_id', 'items_done'],
  block: ['task_id', 'note'],
  reorder: ['task_id', 'sort_order'],
  delete: ['task_id'],
  detail: ['task_id'],
}

export function refuseUnreadFields(
  input: { action: KanbanAction } & Record<string, unknown>,
): void {
  const reads = READS[input.action]
  const unread = Object.keys(input).filter(
    (field) => field !== 'action' && input[field] !== undefined && !reads.includes(field),
  )
  if (!unread.length) return
  const owners = unread.map((field) => {
    const readers = (Object.keys(READS) as KanbanAction[]).filter((action) =>
      READS[action].includes(field),
    )
    return readers.length ? `${field} (${readers.join(', ')})` : field
  })
  throw new BoardRefusal(
    400,
    'unread_field',
    `${input.action} does not take ${owners.join(', ')}. Nothing was changed; call the action that does.`,
  )
}

/**
 * The columns `update` may NOT move a card to, and the action that does it instead.
 *
 * The workflow's bookkeeping lives in those actions: `take` checks dependencies and assigns the
 * acting agent, `complete` names the cards finishing releases, `block` records the obstacle. A status
 * written through `update` skipped all three — a card with an open dependency went to
 * in_progress unassigned, and nothing checked it.
 */
const MOVED_BY: Partial<Record<KanbanStatus, string>> = {
  in_progress: 'take (it checks dependencies and assigns you)',
  done: 'complete (it names the cards finishing releases)',
  blocked: 'block with note (the obstacle is what the column records)',
  review: 'complete (an agent finishes a card with complete; review is a column for people)',
}

export function refuseOwnedMove(status: KanbanStatus | undefined): void {
  const owner = status ? MOVED_BY[status] : undefined
  if (owner)
    throw new BoardRefusal(
      400,
      'use_action',
      `update does not move a card to ${status}; use ${owner}.`,
    )
}

const newChecklist = (items: readonly string[]): KanbanSubtask[] =>
  items.map((text) => ({ id: crypto.randomUUID().slice(0, 8), text, done: false }))

/** One checklist entry as the model writes it: the text alone, or the text with its tick. */
export type ChecklistEntry = string | { text: string; done: boolean }

/**
 * A checklist rewritten by `update`: the new item list, in its order. An item whose text is
 * unchanged keeps its id, and keeps its tick unless the entry states one — so the agent can tick
 * an item (`{ text, done: true }`), and revising the list does not undo the work already marked.
 * Without the stated form the agent had no way to tick anything: every card it finished read
 * `[0/2]`.
 */
export function reviseChecklist(
  current: readonly KanbanSubtask[],
  entries: readonly ChecklistEntry[],
): KanbanSubtask[] {
  const unused = [...current]
  return entries.map((entry) => {
    const text = typeof entry === 'string' ? entry : entry.text
    const index = unused.findIndex((item) => item.text === text)
    const kept = index < 0 ? newChecklist([text])[0]! : unused.splice(index, 1)[0]!
    return typeof entry === 'string' ? kept : { ...kept, done: entry.done }
  })
}

/** The open items a `complete` leaves behind, for the answer to name rather than pass over. */
export function openItemsNotice(subtasks: readonly KanbanSubtask[]): string {
  const open = subtasks.filter((item) => !item.done)
  if (!open.length) return ''
  return ` ${open.length} of ${subtasks.length} checklist items are unticked: ${open.map((item) => `"${item.text}"`).join(', ')}. If they were done, complete with items_done: true next time; do not complete the card again.`
}
