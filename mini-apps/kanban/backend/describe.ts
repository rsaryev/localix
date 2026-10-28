import type { KanbanBoard, KanbanTask } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'

/**
 * The board as the MODEL reads it, and how the model's references to cards are resolved.
 *
 * Models name a card by id, by a prefix of it, by a mangled id ("LX-4-task-1"), or by its title —
 * and wire a dependency to a sibling by title more often than by id. Resolving every form against
 * the live board, and naming the candidates when nothing matches, removes the largest class of
 * wasted board calls: a guess, a refusal, another guess.
 */

export function describeTask(task: KanbanTask): string {
  const checklist = task.subtasks.length
    ? ` [${task.subtasks.filter((item) => item.done).length}/${task.subtasks.length}]`
    : ''
  const kind = task.kind === 'epic' ? 'epic ' : ''
  const priority = task.priority ? ` p${task.priority > 0 ? '+' : ''}${task.priority}` : ''
  const owner = task.assignee ? ` → ${task.assignee}` : ''
  const deps = task.dependsOn.length ? ` ⇐ deps: ${task.dependsOn.join(', ')}` : ''
  const blocker = task.error ? ` — ${task.error}` : ''
  return `- [${task.status}] ${kind}${task.id} — ${task.title}${priority}${checklist}${owner}${deps}${blocker}`
}

/** Epics with their tasks beneath them, then the tasks that belong to none. */
export function describeBoard(tasks: readonly KanbanTask[]): string {
  const lines: string[] = []
  for (const epic of tasks.filter((task) => task.kind === 'epic')) {
    lines.push(describeTask(epic))
    for (const child of tasks.filter((task) => task.parentTaskId === epic.id))
      lines.push(`  ${describeTask(child)}`)
  }
  for (const task of tasks)
    if (task.kind !== 'epic' && !task.parentTaskId) lines.push(describeTask(task))
  return lines.join('\n')
}

/**
 * Everything someone needs to do the card's work with nothing else to read: what `detail`
 * returns, and what the agent hands to a delegate as its brief.
 */
export function taskBrief(task: KanbanTask, board: KanbanBoard): string {
  const deps = board.tasks.filter((candidate) => task.dependsOn.includes(candidate.id))
  return [
    `${task.id}: ${task.title}`,
    task.description,
    task.subtasks.length
      ? `Checklist:\n${task.subtasks.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n')}`
      : '',
    deps.length
      ? `Dependencies:\n${deps.map((dep) => `- ${dep.id} (${dep.status}) — ${dep.title}`).join('\n')}`
      : '',
    task.attachedPaths.length
      ? `Attached workspace paths:\n${task.attachedPaths.map((path) => `- ${path}`).join('\n')}`
      : '',
    task.error ? `Blocked: ${task.error}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const CANDIDATES_SHOWN = 8

function candidates(tasks: readonly KanbanTask[]): string {
  const shown = tasks
    .slice(0, CANDIDATES_SHOWN)
    .map((task) => `${task.id} "${task.title.slice(0, 48)}"`)
    .join('; ')
  return tasks.length > CANDIDATES_SHOWN
    ? `${shown} (+${tasks.length - CANDIDATES_SHOWN} more)`
    : shown
}

/** Resolve one reference: exact id → id prefix → mangled id → exact title → unique title part. */
export function resolveTaskReference(tasks: readonly KanbanTask[], raw: string): KanbanTask {
  const needle = raw.trim()
  const exact = tasks.find((task) => task.id === needle)
  if (exact) return exact
  const byPrefix = tasks.filter((task) => task.id.startsWith(needle))
  if (byPrefix.length === 1) return byPrefix[0]!
  const mangled = tasks.filter((task) => needle.startsWith(`${task.id}-`))
  if (mangled.length === 1) return mangled[0]!
  const lower = needle.toLowerCase()
  const byTitle = tasks.filter((task) => task.title.toLowerCase() === lower)
  if (byTitle.length === 1) return byTitle[0]!
  const byTitlePart =
    needle.length > 3 ? tasks.filter((task) => task.title.toLowerCase().includes(lower)) : []
  if (byTitlePart.length === 1) return byTitlePart[0]!
  const ambiguous = byPrefix.length > 1 ? byPrefix : byTitlePart
  if (ambiguous.length > 1)
    throw new BoardRefusal(
      400,
      'ambiguous_task',
      `"${needle}" matches ${ambiguous.length} tasks — use an id: ${candidates(ambiguous)}.`,
    )
  throw new BoardRefusal(
    404,
    'task_not_found',
    tasks.length === 0
      ? `No task matches "${needle}": the board is empty; create it first.`
      : `No task matches "${needle}". Use an id or exact title from the board: ${candidates(tasks)}.`,
  )
}

/** Resolve a depends_on list to ids, de-duplicated, never the card itself. */
export function resolveDependencies(
  tasks: readonly KanbanTask[],
  raw: readonly string[],
  selfId?: string,
): string[] {
  const ids: string[] = []
  for (const reference of raw) {
    const dep = resolveTaskReference(tasks, reference)
    if (dep.id === selfId)
      throw new BoardRefusal(400, 'self_dependency', 'A task cannot depend on itself.')
    if (!ids.includes(dep.id)) ids.push(dep.id)
  }
  return ids
}

/** Every card this completion released: waiting on it, and now on nothing unfinished. */
/**
 * The epic a completion just finished: the card's epic, still open, whose every task is now done
 * or cancelled. An epic's status is its own — the board never moves it — so the agent is TOLD, or
 * it reports "the epic did not complete" and stops with the epic open, and never tries
 * `complete` itself.
 */
export function epicFinishedBy(tasks: readonly KanbanTask[], doneId: string): KanbanTask | null {
  const parentId = tasks.find((task) => task.id === doneId)?.parentTaskId
  const epic = parentId ? tasks.find((task) => task.id === parentId && task.kind === 'epic') : null
  if (!epic || epic.status === 'done' || epic.status === 'cancelled') return null
  const children = tasks.filter((task) => task.parentTaskId === epic.id)
  const finished = children.every((task) => task.status === 'done' || task.status === 'cancelled')
  return children.length > 0 && finished ? epic : null
}

export function unblockedBy(tasks: readonly KanbanTask[], doneId: string): KanbanTask[] {
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks.filter(
    (task) =>
      (task.status === 'backlog' || task.status === 'ready') &&
      task.dependsOn.includes(doneId) &&
      task.dependsOn.every((id) => done.has(id)),
  )
}
