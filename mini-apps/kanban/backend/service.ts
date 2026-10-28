import { HUMAN_ASSIGNEE_ID } from '../shared/rules'
import type { MiniAppAgentDirectory } from '@localixai/mini-app-sdk/backend'
import type { z } from 'zod'

import {
  createKanbanTaskSchema,
  updateKanbanTaskSchema,
  type BoardEvent,
  type CreateKanbanTaskRequest,
  type KanbanBoard,
  type KanbanMove,
  type KanbanOrigin,
  type KanbanTask,
  type UpdateKanbanTaskRequest,
} from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import type { KanbanActor } from '../shared/rules'
import {
  applyMoves,
  createTask,
  removeTask,
  requireTask,
  takeTask,
  updateTask,
  type Assignment,
} from './operations'
import { openBoardStore, type BoardStore } from './store'

/** The board a call acts on: the chat it belongs to, and that chat's owner. */
export interface BoardChat {
  userId: string
  sessionId: string
}

export interface BoardServiceDeps {
  /** The session's mini app folder; the host rejects a session the user does not own. */
  resolveDir: (userId: string, sessionId: string) => Promise<string>
  /** The agents a card may be assigned to. Absent: a card cannot name one. */
  agents?: MiniAppAgentDirectory
  now?: () => string
}

/** An input the contract refuses is the caller's to fix, so it answers as a refusal naming the field. */
function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const field = issue?.path.map(String).join('.') || 'input'
  throw new BoardRefusal(400, 'invalid_task', `${field}: ${issue?.message ?? 'invalid'}`)
}

/**
 * The board's service: each write validates its input, resolves the assignment against the agent
 * registry, and runs as ONE operation behind the board's queue.
 *
 * The registry is asked BEFORE the queue is entered. It is an outside lookup that can be slow,
 * and a queue held across it would stall every other write to the board for its length.
 */
export function createBoardService(deps: BoardServiceDeps) {
  const now = deps.now ?? (() => new Date().toISOString())
  const storeOf = async (chat: BoardChat): Promise<BoardStore> =>
    openBoardStore(await deps.resolveDir(chat.userId, chat.sessionId))

  async function resolveAssignment(
    chat: BoardChat,
    reference: string | null | undefined,
  ): Promise<Assignment | undefined> {
    if (reference === undefined) return undefined
    if (reference === null) return { agentId: null, assignee: null }
    if (!deps.agents)
      throw new BoardRefusal(409, 'agents_unavailable', 'This board cannot assign agents here.')
    const wanted = reference.trim()
    // The person is not an agent and the directory does not list them: their id is the board's own.
    if (wanted === HUMAN_ASSIGNEE_ID) return { agentId: HUMAN_ASSIGNEE_ID, assignee: 'you' }
    const agents = await deps.agents.list(chat.userId, chat.sessionId)
    const agent =
      agents.find((candidate) => candidate.id === wanted) ??
      agents.find((candidate) => candidate.name === wanted)
    if (agent) return { agentId: agent.id, assignee: agent.name }
    const available = agents.map((candidate) => `${candidate.name} (${candidate.id})`).join(', ')
    throw new BoardRefusal(
      404,
      'agent_unavailable',
      `No agent "${reference}" here. ${available ? `Available: ${available}, or "${HUMAN_ASSIGNEE_ID}" for the person.` : 'No agents are available.'}`,
    )
  }

  /** A card handed to the person waits on them: tell them wherever they are. */
  const tellHuman = (chat: BoardChat, task: KanbanTask) => {
    if (task.agentId !== HUMAN_ASSIGNEE_ID) return
    void deps.agents
      ?.notifyHuman?.(chat.userId, chat.sessionId, {
        key: `kanban:${task.id}`,
        text: `${task.id} is assigned to you: ${task.title}`,
      })
      .catch(() => {})
  }

  const announce = (chat: BoardChat, type: 'task.created' | 'task.updated', task: KanbanTask) =>
    ({ type, sessionId: chat.sessionId, task }) satisfies BoardEvent

  return {
    async read(chat: BoardChat): Promise<KanbanBoard> {
      return (await storeOf(chat)).read()
    },

    async get(chat: BoardChat, id: string): Promise<KanbanTask> {
      return requireTask(await (await storeOf(chat)).read(), id)
    },

    async create(
      chat: BoardChat,
      raw: CreateKanbanTaskRequest,
      origin: KanbanOrigin,
    ): Promise<KanbanTask> {
      const input = parseInput(createKanbanTaskSchema, raw)
      const assignment = (await resolveAssignment(chat, input.agent)) ?? {
        agentId: null,
        assignee: null,
      }
      const created = await (
        await storeOf(chat)
      ).update((board) => {
        const { board: next, task } = createTask(
          board,
          {
            title: input.title,
            description: input.description ?? '',
            status: input.status ?? 'backlog',
            kind: input.kind ?? 'task',
            parentTaskId: input.parentTaskId ?? null,
            dependsOn: input.dependsOn ?? [],
            attachedPaths: input.attachedPaths ?? [],
            labels: input.labels ?? [],
            priority: input.priority ?? 0,
            subtasks: input.subtasks ?? [],
          },
          assignment,
          origin,
          now(),
        )
        return { board: next, events: [announce(chat, 'task.created', task)], result: task }
      })
      tellHuman(chat, created)
      return created
    },

    async update(
      chat: BoardChat,
      id: string,
      raw: UpdateKanbanTaskRequest,
      actor: KanbanActor,
    ): Promise<KanbanTask> {
      const { expectedUpdatedAt, agent, ...patch } = parseInput(updateKanbanTaskSchema, raw)
      const assignment = await resolveAssignment(chat, agent)
      const before = assignment
        ? (await (await storeOf(chat)).read()).tasks.find((t) => t.id === id)
        : undefined
      const updated = await (
        await storeOf(chat)
      ).update((board) => {
        const { board: next, task } = updateTask(
          board,
          id,
          patch,
          {
            actor,
            ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
            ...(assignment ? { assignment } : {}),
          },
          now(),
        )
        return { board: next, events: [announce(chat, 'task.updated', task)], result: task }
      })
      if (assignment && before?.agentId !== HUMAN_ASSIGNEE_ID) tellHuman(chat, updated)
      return updated
    },

    async move(chat: BoardChat, moves: readonly KanbanMove[], actor: KanbanActor) {
      return (await storeOf(chat)).update((board) => {
        const { board: next, tasks } = applyMoves(board, moves, actor, now())
        return {
          board: next,
          events: tasks.map((task) => announce(chat, 'task.updated', task)),
          result: tasks,
        }
      })
    },

    async remove(chat: BoardChat, id: string): Promise<void> {
      await (
        await storeOf(chat)
      ).update((board) => {
        const { board: next, pruned } = removeTask(board, id, now())
        return {
          board: next,
          events: [
            { type: 'task.deleted', sessionId: chat.sessionId, taskId: id } satisfies BoardEvent,
            ...pruned.map((task) => announce(chat, 'task.updated', task)),
          ],
          result: undefined,
        }
      })
    },

    async take(
      chat: BoardChat,
      id: string,
      taker: { agentId: string; assignee: string },
    ): Promise<KanbanTask> {
      return (await storeOf(chat)).update((board) => {
        const { board: next, task } = takeTask(board, id, taker, now())
        return { board: next, events: [announce(chat, 'task.updated', task)], result: task }
      })
    },

    /** Follow one board's changes; resolves once the session's ownership was checked. */
    async subscribe(chat: BoardChat, listener: (event: BoardEvent) => void): Promise<() => void> {
      return (await storeOf(chat)).subscribe(listener)
    },
  }
}

export type BoardService = ReturnType<typeof createBoardService>
