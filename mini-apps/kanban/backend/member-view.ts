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

/**
 * Cards a member may read but not work: the ones its own cards depend on, and the ones that depend
 * on its cards. Seeing their state lets a member say "waiting on LX-3 (review)" instead of guessing.
 */
export function relatedCards(
  tasks: readonly KanbanTask[],
  speaker: BoardSpeaker | undefined,
): readonly KanbanTask[] {
  if (leadsBoard(speaker)) return []
  const own = visibleTo(tasks, speaker)
  const ownIds = new Set(own.map((task) => task.id))
  const upstream = new Set(own.flatMap((task) => task.dependsOn))
  return tasks.filter(
    (task) =>
      !ownIds.has(task.id) &&
      (upstream.has(task.id) || task.dependsOn.some((id) => ownIds.has(id))),
  )
}

/** The cards a member's own cards wait on, marked read-only, for its list. */
export function describeDependencies(
  own: readonly KanbanTask[],
  board: readonly KanbanTask[],
): string {
  const lines = board
    .filter((task) => !own.includes(task))
    .map((task) => {
      const waiting = own.filter((card) => card.dependsOn.includes(task.id)).map((card) => card.id)
      return waiting.length
        ? `${describeTask(task)} (dependency of ${waiting.join(', ')}; read-only)`
        : null
    })
    .filter((line): line is string => line !== null)
  return lines.length ? `\nDependencies:\n${lines.join('\n')}` : ''
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
