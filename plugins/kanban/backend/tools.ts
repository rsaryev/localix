import type { AgentToolExecutionContext, PluginContext } from '@localixai/plugin-sdk/backend'

import { AGENT_TARGET_STATUSES } from '../shared/rules'
import { BoardRefusal } from '../shared/errors'
import { classifyKanbanCall } from './call-class'
import { boardUri } from '../shared/resource'
import { KANBAN_ACTIONS, KANBAN_TOOL, slimTask, type KanbanToolDetails } from '../shared/tool'
import type { KanbanStatus, KanbanTask } from '../shared/contracts'
import {
  describeBoard,
  describeTask,
  epicFinishedBy,
  resolveDependencies,
  resolveTaskReference,
  taskBrief,
  unblockedBy,
} from './describe'
import type { BoardSeat, BoardService } from './service'
import { openItemsNotice, refuseOwnedMove, refuseUnreadFields, reviseChecklist } from './tool-input'

type Result = { content: string; details?: KanbanToolDetails; isError?: boolean }

/**
 * The agent's side of the board — ONE tool, `kanban`, whose `action` says what it does.
 *
 * Every action acts on the board of the chat the call RUNS in (the session the host names in the
 * call's context), so an agent in one chat can never touch another chat's board. `take` needs to
 * know WHO is taking, and reads it from the call's speaker — never from the input, where a model
 * could name someone else.
 *
 * The board is passive: no action starts a run, wakes an agent or invites a participant. Who does
 * a card's work is the agent's decision, made with its own tools.
 */

const LIST_CAP = 50

export function createKanbanTools(ctx: PluginContext, boards: BoardService) {
  const z = ctx.z
  const createEntry = z.object({
    title: z.string().describe('The card title.'),
    description: z.string().optional(),
    agent: z.string().optional().describe('Agent id or handle (with or without @) to assign.'),
    kind: z.enum(['epic', 'task']).optional(),
    parent: z.string().optional().describe('The epic this task belongs to (id or title).'),
    depends_on: z
      .array(z.string())
      .optional()
      .describe('Cards that must be done first: ids, or exact titles of EARLIER batch entries.'),
    priority: z.number().int().min(-2).max(2).optional(),
    items: z.array(z.string()).optional().describe('Checklist items.'),
  })
  const inputSchema = z.object({
    action: z.enum(KANBAN_ACTIONS),
    task_id: z.string().optional().describe('The card: its id or exact title.'),
    query: z.string().optional().describe('For "search": words every match contains.'),
    title: z.string().optional(),
    description: z.string().optional(),
    agent: z.string().optional().describe('Agent id or handle (with or without @) to assign.'),
    kind: z.enum(['epic', 'task']).optional(),
    parent: z.string().optional().describe('The epic the card belongs to (id or title).'),
    status: z
      .enum(AGENT_TARGET_STATUSES as [KanbanStatus, ...KanbanStatus[]])
      .optional()
      .describe(
        'For "update": backlog, ready or cancelled. take, complete and block own the rest.',
      ),
    depends_on: z.array(z.string()).optional(),
    priority: z.number().int().min(-2).max(2).optional(),
    note: z.string().optional().describe('For "block": the concrete obstacle.'),
    items: z
      .array(z.union([z.string(), z.object({ text: z.string(), done: z.boolean() })]))
      .optional()
      .describe(
        'For "update": the whole checklist, in order. A plain string keeps an existing item’s tick; { text, done } sets it.',
      ),
    sort_order: z.number().optional(),
    creates: z
      .array(createEntry)
      .optional()
      .describe('For "create": an ordered batch, prerequisites first.'),
  })
  type Input = ReturnType<typeof inputSchema.parse>
  /** The actions that name one card; `list`, `search` and `create` are answered before them. */
  type CardAction = Exclude<Input['action'], 'list' | 'search' | 'create'>

  const seatOf = (context: AgentToolExecutionContext | undefined): BoardSeat => {
    const sessionId = context?.session?.id
    if (!sessionId)
      throw new BoardRefusal(400, 'no_board', 'The board belongs to a chat; this call has none.')
    return { userId: ctx.userId, sessionId }
  }

  async function create(seat: BoardSeat, input: Input): Promise<Result> {
    const entries = input.creates?.length ? input.creates : [{ ...input, title: input.title ?? '' }]
    const created: KanbanTask[] = []
    let refused: string | null = null
    for (const [index, entry] of entries.entries()) {
      try {
        if (!entry.title.trim())
          throw new BoardRefusal(400, 'title_required', 'create requires title.')
        const tasks = (await boards.read(seat)).tasks
        const parent = entry.parent ? resolveTaskReference(tasks, entry.parent) : null
        created.push(
          await boards.create(
            seat,
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
        sessionId: seat.sessionId,
        ...(created.length === 1 ? { task: created[0]! } : { tasks: created.map(slimTask) }),
        reveal: ctx.ui.open({
          uri: boardUri(seat.sessionId),
          label: 'Open board',
          description: 'This chat’s board',
        }),
      },
    }
  }

  async function onTask(
    seat: BoardSeat,
    action: CardAction,
    input: Input,
    context: AgentToolExecutionContext | undefined,
  ): Promise<Result> {
    if (!input.task_id) throw new BoardRefusal(400, 'task_required', `${action} requires task_id.`)
    const board = await boards.read(seat)
    const task = resolveTaskReference(board.tasks, input.task_id)
    const done = (content: string, written: KanbanTask): Result => ({
      content,
      details: { sessionId: seat.sessionId, task: written },
    })
    switch (action) {
      case 'detail':
        return done(taskBrief(task, board), task)
      case 'delete':
        await boards.remove(seat, task.id)
        return { content: `Deleted ${task.id}.`, details: { sessionId: seat.sessionId } }
      case 'reorder':
        if (input.sort_order === undefined)
          throw new BoardRefusal(400, 'sort_order_required', 'reorder requires sort_order.')
        return done(
          `Reordered ${task.id}.`,
          await boards.update(seat, task.id, { sortOrder: input.sort_order }, 'agent'),
        )
      case 'take': {
        const speaker = context?.session?.speaker
        if (!speaker)
          throw new BoardRefusal(
            409,
            'no_speaker',
            'Only an agent speaking in this chat can take a card.',
          )
        if (task.agentId && task.agentId !== speaker.agentId) {
          const owner = `@${task.assignee ?? task.agentId}`
          throw new BoardRefusal(
            409,
            'task_assigned',
            `${task.id} is assigned to ${owner}. Give ${owner} a turn, or delegate it with the card's detail as the brief. To do it yourself, reassign it first (update with agent).`,
          )
        }
        const taken = await boards.take(seat, task.id, {
          agentId: speaker.agentId,
          assignee: speaker.handle,
        })
        return done(`Took ${task.id}. Do the work directly.`, taken)
      }
      case 'complete': {
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
      case 'block': {
        const reason = input.note?.trim()
        if (!reason) throw new BoardRefusal(400, 'note_required', 'block requires note.')
        return done(
          `Blocked ${task.id}.`,
          await boards.update(seat, task.id, { status: 'blocked', error: reason }, 'agent'),
        )
      }
      case 'update': {
        refuseOwnedMove(input.status)
        const parent = input.parent ? resolveTaskReference(board.tasks, input.parent) : null
        const written = await boards.update(
          seat,
          task.id,
          {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.agent !== undefined ? { agent: input.agent } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(parent ? { parentTaskId: parent.id } : {}),
            ...(input.items ? { subtasks: reviseChecklist(task.subtasks, input.items) } : {}),
            ...(input.depends_on
              ? { dependsOn: resolveDependencies(board.tasks, input.depends_on, task.id) }
              : {}),
          },
          'agent',
        )
        return done(`Updated ${written.id}: ${describeTask(written)}`, written)
      }
    }
  }

  async function list(seat: BoardSeat, input: Input): Promise<Result> {
    let tasks = (await boards.read(seat)).tasks
    if (input.action === 'search') {
      const terms = input.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? []
      if (!terms.length) throw new BoardRefusal(400, 'query_required', 'search requires query.')
      tasks = tasks.filter((task) =>
        terms.every((term) =>
          `${task.id} ${task.title} ${task.description}`.toLowerCase().includes(term),
        ),
      )
    }
    const visible = tasks.slice(0, LIST_CAP)
    const more =
      tasks.length > visible.length ? `\nShowing ${LIST_CAP} of ${tasks.length} tasks.` : ''
    return {
      content: tasks.length ? `${describeBoard(visible)}${more}` : 'No matching board tasks.',
      details: { sessionId: seat.sessionId, tasks: visible.map(slimTask) },
    }
  }

  return [
    ctx.defineTool({
      name: KANBAN_TOOL,
      label: 'Kanban board',
      activeVerb: 'Updating board',
      description: [
        'Read and edit this chat’s task board: epics, tasks, dependencies, checklists, owners and blockers. It is passive — no card state starts work.',
        'Put multi-part, durable work on the board; a small single deliverable needs no card.',
        'take a card before working it yourself (checks dependencies, assigns you, moves it to in_progress); complete it when done, or block it with the concrete obstacle.',
        'For a card another agent should do, give that participant a turn or delegate it with the card’s detail as the brief; review the report before you complete or block the card.',
      ].join(' '),
      inputSchema,
      mutates: true,
      executionMode: 'sequential',
      classify: classifyKanbanCall,
      permissionResources: (input) => [(input as Input).action],
      async execute(_toolCallId, input, _signal, _onUpdate, context): Promise<Result> {
        try {
          refuseUnreadFields(input)
          const seat = seatOf(context)
          if (input.action === 'list' || input.action === 'search') return await list(seat, input)
          if (input.action === 'create') return await create(seat, input)
          return await onTask(seat, input.action, input, context)
        } catch (error) {
          if (error instanceof BoardRefusal) return { content: error.message, isError: true }
          throw error
        }
      },
    }),
  ]
}
