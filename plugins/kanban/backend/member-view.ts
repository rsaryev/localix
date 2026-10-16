import type { KanbanTask } from '../shared/contracts'
import { leadsBoard, type BoardSpeaker } from '../shared/rules'
import { describeTask, resolveTaskReference } from './describe'

/**
 * The board as one speaker may read it. The leader reads every card; a member reads only the
 * cards assigned to it, so a lookup, a list or a "did you mean" never shows a colleague's work.
 */

export const visibleTo = (
  tasks: readonly KanbanTask[],
  speaker: BoardSpeaker | undefined,
): readonly KanbanTask[] =>
  leadsBoard(speaker) ? tasks : tasks.filter((task) => task.agentId === speaker!.agentId)

/**
 * Resolve a card reference for this speaker. A member may still name any card by its exact id —
 * the refusal that follows says whose it is — but every fuzzier match, and every candidate list,
 * reads only its own cards.
 */
export function resolveFor(
  tasks: readonly KanbanTask[],
  speaker: BoardSpeaker | undefined,
  raw: string,
  /** Cards the member may also name by title: the ones its own batch just created. */
  also: readonly KanbanTask[] = [],
): KanbanTask {
  if (leadsBoard(speaker)) return resolveTaskReference(tasks, raw)
  const exact = tasks.find((task) => task.id === raw.trim())
  return exact ?? resolveTaskReference([...visibleTo(tasks, speaker), ...also], raw)
}

/** A member's own cards, each with the title of its epic as context. */
export function describeOwnCards(own: readonly KanbanTask[], board: readonly KanbanTask[]): string {
  return own
    .map((task) => {
      const epic = task.parentTaskId ? board.find((card) => card.id === task.parentTaskId) : null
      return `${describeTask(task)}${epic ? ` (epic ${epic.id} "${epic.title}")` : ''}`
    })
    .join('\n')
}
