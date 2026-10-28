/**
 * TaskCreated / TaskCompleted on Localix's task board.
 *
 * Claude Code fires them for its TaskCreate / TaskUpdate tools. Localix's equivalent is the task
 * board's `kanban` tool (the bundled kanban plugin): `create` puts cards on the board and
 * `complete` closes one. As in CC:
 *   - TaskCreated runs once a card exists; a block takes the card off the board again and the
 *     reason reaches the model as the tool's error;
 *   - TaskCompleted runs before the card closes; a block leaves it open and the reason reaches the
 *     model as the tool's error.
 * The board is read and written through the same tool, so this module knows only its action
 * vocabulary, never its storage.
 */
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { isRecord } from '../../lib/record'
import type { CcTask } from './runtime-contracts-added'
import type { CcHooksRuntime } from './run'

/** The task board tool and the actions TaskCreated / TaskCompleted stand for. */
export const TASK_BOARD_TOOL = 'kanban'

type Execute = AgentTool['execute']
type ExecuteArgs = Readonly<Parameters<Execute>>

interface BoardCard {
  id: string
  title: string
  description?: string
}

/** The task event a call stands for, when the runtime has hooks on it. */
export function taskBoardEvent(
  runtime: CcHooksRuntime,
  toolName: string,
  input: unknown,
): 'TaskCreated' | 'TaskCompleted' | null {
  if (toolName !== TASK_BOARD_TOOL || !isRecord(input)) return null
  const event =
    input.action === 'create' ? 'TaskCreated' : input.action === 'complete' ? 'TaskCompleted' : null
  return event && runtime.hasHooks(event) ? event : null
}

function cardsOf(result: AgentToolResult): BoardCard[] {
  const details = isRecord(result.details) ? result.details : {}
  const cards = isRecord(details.task)
    ? [details.task]
    : Array.isArray(details.tasks)
      ? details.tasks
      : []
  return cards.filter(
    (c): c is BoardCard => isRecord(c) && typeof c.id === 'string' && typeof c.title === 'string',
  )
}

const asTask = (card: BoardCard): CcTask => ({
  id: card.id,
  subject: card.title,
  ...(card.description ? { description: card.description } : {}),
})

/**
 * Before `complete`: the card is read through the board (`detail`) for its subject, then the
 * hooks decide. Returns the block reason, or undefined to let the card close.
 */
export async function blockTaskCompletion(
  runtime: CcHooksRuntime,
  tool: AgentTool,
  [toolCallId, input, signal, , context]: ExecuteArgs,
): Promise<string | undefined> {
  const taskId = isRecord(input) && typeof input.task_id === 'string' ? input.task_id : ''
  let card: BoardCard = { id: taskId, title: taskId }
  try {
    const read = await tool.execute(
      `${toolCallId}:task`,
      { action: 'detail', task_id: taskId },
      signal,
      undefined,
      context,
    )
    card = cardsOf(read)[0] ?? card
  } catch {
    // An unreadable card still reaches the hooks by the id the call named.
  }
  const verdict = await runtime.runTaskCompleted(asTask(card))
  return verdict.blocked ? verdict.reason || 'Task completion blocked by hook' : undefined
}

/**
 * After `create`: each new card goes to the hooks; a blocked one is deleted again. Returns the
 * result to hand on, and the block reason when no card the call made survived.
 */
export async function reviewTaskCreation(
  runtime: CcHooksRuntime,
  tool: AgentTool,
  [toolCallId, , signal, , context]: ExecuteArgs,
  result: AgentToolResult,
): Promise<{ result: AgentToolResult; blocked?: string }> {
  const cards = cardsOf(result)
  const refused: string[] = []
  for (const card of cards) {
    const verdict = await runtime.runTaskCreated(asTask(card))
    if (!verdict.blocked) continue
    const reason = verdict.reason || 'Task creation blocked by hook'
    await tool
      .execute(
        `${toolCallId}:undo`,
        { action: 'delete', task_id: card.id },
        signal,
        undefined,
        context,
      )
      .catch(() => {})
    refused.push(`${card.id} "${card.title}" was not created: ${reason}`)
  }
  if (refused.length === 0) return { result }
  if (refused.length === cards.length) return { result, blocked: refused.join('\n') }
  return { result: { ...result, content: [result.content, ...refused].join('\n') } }
}
