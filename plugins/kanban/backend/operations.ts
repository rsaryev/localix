import {
  taskRef,
  type KanbanBoard,
  type KanbanMove,
  type KanbanOrigin,
  type KanbanStatus,
  type KanbanSubtask,
  type KanbanTask,
} from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import { canTransition, takeEligibility, type KanbanActor } from '../shared/rules'

/**
 * Every board write, as a pure function from one board value to the next.
 *
 * Each operation validates and THEN writes, and a refusal throws before anything is returned —
 * so a caller that persists only what an operation returns can never store half a batch. The
 * service runs them one at a time per board, which is what makes "was legal when I looked" the
 * same as "is legal now": there is no window between the check and the write.
 */

/** Who a card is assigned to, already resolved against the agent registry. */
export interface Assignment {
  agentId: string | null
  assignee: string | null
}

export interface TaskFields {
  title: string
  description: string
  status: KanbanStatus
  kind: 'epic' | 'task'
  parentTaskId: string | null
  dependsOn: string[]
  attachedPaths: string[]
  labels: string[]
  priority: number
  subtasks: KanbanSubtask[]
}

export type TaskPatch = Partial<
  Omit<TaskFields, 'kind'> & { error: string | null; sortOrder: number } & Pick<
      KanbanTask,
      'artifacts'
    >
>

const notFound = (id: string) =>
  new BoardRefusal(404, 'task_not_found', `No task ${id} on this board.`)

export function requireTask(board: KanbanBoard, id: string): KanbanTask {
  const task = board.tasks.find((candidate) => candidate.id === id)
  if (!task) throw notFound(id)
  return task
}

/**
 * The next `updatedAt`. It doubles as the edit token, so two writes in the same millisecond
 * must not share one — a stale editor would then replace the newer card.
 */
export function nextStamp(now: string, previous?: string): string {
  if (!previous || now > previous) return now
  return new Date(Date.parse(previous) + 1).toISOString()
}

const nextOrder = (board: KanbanBoard, status: KanbanStatus) =>
  Math.max(0, ...board.tasks.filter((task) => task.status === status).map((t) => t.sortOrder)) + 1

/**
 * True when giving `taskId` these dependencies closes a cycle. A card in a cycle can never be
 * taken — each waits on the next — so the whole ring would sit in the backlog with no error.
 */
export function wouldCreateCycle(
  board: KanbanBoard,
  taskId: string,
  proposed: readonly string[],
): boolean {
  const edges = new Map(board.tasks.map((task) => [task.id, task.dependsOn]))
  const seen = new Set<string>()
  const stack = [...proposed]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === taskId) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(edges.get(current) ?? []))
  }
  return false
}

/**
 * Parent and dependency edges must be satisfiable: a dependency that does not exist, or that
 * leads back to the card, would freeze it forever; a parent must be an epic, and an epic has none.
 */
function assertRelationships(board: KanbanBoard, task: KanbanTask): void {
  const byId = new Map(board.tasks.map((candidate) => [candidate.id, candidate]))
  const unknown = task.dependsOn.filter((id) => !byId.has(id) || id === task.id)
  if (unknown.length > 0)
    throw new BoardRefusal(
      400,
      'unknown_dependency',
      `${task.id} cannot depend on ${unknown.join(', ')}: a dependency must be another card on this board.`,
    )
  if (task.dependsOn.length > 0 && wouldCreateCycle(board, task.id, task.dependsOn))
    throw new BoardRefusal(
      400,
      'dependency_cycle',
      `These dependencies would make ${task.id} wait on itself; cards in a cycle can never start.`,
    )
  if (task.parentTaskId === null) return
  const parent = byId.get(task.parentTaskId)
  if (parent?.kind !== 'epic' || task.kind === 'epic' || parent.id === task.id)
    throw new BoardRefusal(400, 'task_parent', 'Only a task may belong to an epic.')
}

function assertMove(actor: KanbanActor, current: KanbanTask, to: KanbanStatus): void {
  const move = canTransition(actor, current.kind, current.status, to)
  // 409: well-formed, and legal from another column — it conflicts with the card's state.
  if (!move.ok) throw new BoardRefusal(409, 'forbidden_transition', move.why)
}

const replace = (board: KanbanBoard, next: KanbanTask): KanbanBoard => ({
  ...board,
  tasks: board.tasks.map((task) => (task.id === next.id ? next : task)),
})

export function createTask(
  board: KanbanBoard,
  fields: TaskFields,
  assignment: Assignment,
  origin: KanbanOrigin,
  now: string,
): { board: KanbanBoard; task: KanbanTask } {
  const seq = board.nextSeq
  const task: KanbanTask = {
    id: taskRef(seq),
    seq,
    ...fields,
    ...assignment,
    error: null,
    artifacts: [],
    origin,
    sortOrder: nextOrder(board, fields.status),
    createdAt: now,
    updatedAt: now,
  }
  const next = { ...board, nextSeq: seq + 1, tasks: [...board.tasks, task] }
  assertRelationships(next, task)
  return { board: next, task }
}

export function updateTask(
  board: KanbanBoard,
  id: string,
  patch: TaskPatch,
  opts: { actor: KanbanActor; expectedUpdatedAt?: string; assignment?: Assignment },
  now: string,
): { board: KanbanBoard; task: KanbanTask } {
  const current = requireTask(board, id)
  if (opts.expectedUpdatedAt && opts.expectedUpdatedAt !== current.updatedAt)
    throw new BoardRefusal(409, 'task_changed', 'The task changed. Read it again before editing.')
  if (patch.status !== undefined) assertMove(opts.actor, current, patch.status)
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as TaskPatch
  // A card put back into `ready` without a stated reason has had its blocker dealt with.
  const clearsError = patch.status === 'ready' && patch.error === undefined
  // A running card handed to someone else goes back to `ready`, or its new owner could never
  // take it: `take` refuses a card that is already in progress.
  const handedOver =
    patch.status === undefined &&
    opts.assignment !== undefined &&
    opts.assignment.agentId !== current.agentId &&
    (current.status === 'in_progress' || current.status === 'review')
  const task: KanbanTask = {
    ...current,
    ...defined,
    ...opts.assignment,
    ...(clearsError ? { error: null } : {}),
    ...(handedOver ? { status: 'ready' as const, error: null } : {}),
    updatedAt: nextStamp(now, current.updatedAt),
  }
  const next = replace(board, task)
  assertRelationships(next, task)
  return { board: next, task }
}

/**
 * A whole drag at once. Every move is checked before the first one is applied, so a batch with
 * one illegal move — a multi-select that picked up a running card — changes nothing.
 */
export function applyMoves(
  board: KanbanBoard,
  moves: readonly KanbanMove[],
  actor: KanbanActor,
  now: string,
): { board: KanbanBoard; tasks: KanbanTask[] } {
  if (new Set(moves.map((move) => move.id)).size !== moves.length)
    throw new BoardRefusal(400, 'duplicate_move', 'Each task may appear once in a move batch.')
  let next = board
  const tasks: KanbanTask[] = []
  for (const move of moves) {
    const current = requireTask(board, move.id)
    assertMove(actor, current, move.status)
    const task: KanbanTask = {
      ...current,
      status: move.status,
      sortOrder: move.sortOrder,
      ...(move.parentTaskId !== undefined ? { parentTaskId: move.parentTaskId } : {}),
      ...(move.status === 'ready' && current.status !== 'ready' ? { error: null } : {}),
      updatedAt: nextStamp(now, current.updatedAt),
    }
    next = replace(next, task)
    tasks.push(task)
  }
  for (const task of tasks) assertRelationships(next, task)
  return { board: next, tasks }
}

/** Delete a card, and drop its id from every card that depended on it. */
export function removeTask(
  board: KanbanBoard,
  id: string,
  now: string,
): { board: KanbanBoard; pruned: KanbanTask[] } {
  requireTask(board, id)
  const pruned: KanbanTask[] = []
  const tasks = board.tasks.flatMap((task) => {
    if (task.id === id) return []
    const orphaned = task.parentTaskId === id
    if (!task.dependsOn.includes(id) && !orphaned) return [task]
    const next: KanbanTask = {
      ...task,
      dependsOn: task.dependsOn.filter((dependency) => dependency !== id),
      ...(orphaned ? { parentTaskId: null } : {}),
      updatedAt: nextStamp(now, task.updatedAt),
    }
    pruned.push(next)
    return [next]
  })
  return { board: { ...board, tasks }, pruned }
}

/**
 * Take a card: it must be takeable, its dependencies done, and — unless the taker is also
 * becoming its assignee — still assigned to the one taking it.
 */
export function takeTask(
  board: KanbanBoard,
  id: string,
  taker: { agentId: string; assignee: string; expectedUpdatedAt?: string },
  now: string,
): { board: KanbanBoard; task: KanbanTask } {
  const current = requireTask(board, id)
  if (taker.expectedUpdatedAt && taker.expectedUpdatedAt !== current.updatedAt)
    throw new BoardRefusal(409, 'task_changed', 'The task changed; read the card again.')
  if (current.agentId && current.agentId !== taker.agentId)
    throw new BoardRefusal(
      409,
      'task_assigned',
      `${current.id} is assigned to @${current.assignee ?? current.agentId}. Reassign it before taking it.`,
    )
  const verdict = takeEligibility(current, board.tasks)
  if (!verdict.ok) throw new BoardRefusal(409, `task_${verdict.reason}`, verdict.why)
  const task: KanbanTask = {
    ...current,
    status: 'in_progress',
    error: null,
    agentId: taker.agentId,
    assignee: taker.assignee,
    updatedAt: nextStamp(now, current.updatedAt),
  }
  return { board: replace(board, task), task }
}
