import { randomUUID } from 'node:crypto'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import { fieldOf, fireIn, hearsIn, type ModEventScope } from './event-scope'
import { claudeCodeToolName } from './tool-shapes'

/**
 * The conversation's own events in a run. `session.compact` fires when Localix is about to take a
 * context checkpoint (its compaction): `{ skip }` keeps the conversation whole this turn — the
 * hard ceiling of a request too big to send still applies — and a checkpoint a mod asked for
 * (`$.session.compact`) is taken as the turn starts, its hooks having run on the call.
 * `session.append` fires for each row the run stores: a tool's result before the model reads it,
 * and the answer before it is written; `next({ ...e, message })` rewrites what is stored and sent.
 */

export type CompactionVerdict = 'keep' | 'skip' | 'take'

/** Whether the checkpoint due now (`due`) stands, is skipped, or a mod's request takes one. */
export async function reviewCompaction(
  scope: ModEventScope,
  due: string | undefined,
): Promise<CompactionVerdict> {
  if (scope.host.conversations.takeCompaction(scope.scene.sessionId)) return due ? 'keep' : 'take'
  if (!due || !hearsIn(scope, 'session.compact')) return 'keep'
  const session = await scope.host.ports.readSession?.(scope.scene)
  const input = { trigger: 'auto', messages: session?.messages ?? [] }
  const answer = await fireIn(scope, 'session.compact', input, (e) => ({
    messages: fieldOf(e, 'messages') ?? [],
  }))
  return typeof fieldOf(answer, 'skip') === 'string' ? 'skip' : 'keep'
}

type Block = Record<string, unknown>

/** A row through `session.append`: the blocks that reached the bottom are what is stored. */
async function appended(
  scope: ModEventScope,
  row: { message: Record<string, unknown>; door: string; origin: Record<string, unknown> },
): Promise<Block[]> {
  let stored = row.message.content as Block[]
  const uuid = randomUUID()
  await fireIn(scope, 'session.append', { ...row, uuid }, (e) => {
    const content = fieldOf(fieldOf(e, 'message'), 'content')
    if (Array.isArray(content)) stored = content as Block[]
    return { message: { ...row.message, content: stored }, uuid }
  })
  return stored
}

const textOf = (blocks: readonly Block[]) =>
  blocks.flatMap((block) => (typeof block.text === 'string' ? [block.text] : [])).join('\n')

/** The answer's text as stored, through `session.append` (`response`). */
export async function appendResponse(
  scope: ModEventScope,
  text: string,
  model: string,
): Promise<string> {
  if (!text || !hearsIn(scope, 'session.append')) return text
  const blocks = await appended(scope, {
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model },
  })
  return textOf(blocks)
}

/** A payload whose answer a hook rewrote: its content, and its one text item with it. */
export function withResponse<P extends { content?: unknown; items?: readonly unknown[] }>(
  payload: P,
  text: string,
): P {
  const texts = (payload.items ?? []).flatMap((item, index) =>
    (item as { type?: unknown }).type === 'text' ? [index] : [],
  )
  // With several text items the content is their flat join and cannot be split back.
  const items =
    texts.length === 1
      ? payload.items!.map((item, index) =>
          index === texts[0] ? { ...(item as object), text } : item,
        )
      : payload.items
  return { ...payload, content: text, ...(items ? { items } : {}) }
}

/** Every tool's result through `session.append` (`tool-result`) before the model reads it. */
export function wrapToolResults(tools: readonly AgentTool[], scope: ModEventScope): AgentTool[] {
  if (!hearsIn(scope, 'session.append')) return [...tools]
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      const result = await tool.execute(toolCallId, input, signal, onUpdate, context)
      if (typeof result.content !== 'string') return result
      const content = [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: result.content,
          is_error: result.isError === true,
        },
      ]
      const [stored] = await appended(scope, {
        message: { type: 'user', role: 'user', content },
        door: 'tool-result',
        origin: { kind: 'tool', tool: claudeCodeToolName(tool) },
      })
      const text = fieldOf(stored, 'content')
      const isError = fieldOf(stored, 'is_error')
      if (typeof text !== 'string') return result
      return {
        ...result,
        content: text,
        ...(typeof isError === 'boolean' ? { isError } : {}),
      } satisfies AgentToolResult
    },
  }))
}
