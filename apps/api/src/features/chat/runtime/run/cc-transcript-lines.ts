import { createHash } from 'node:crypto'
import { isToolBackedItem, type AgentItem, type ToolBackedItem } from '@localixai/agent/agents'

import type { PersistedMessage } from '../../contracts'
import { claudeCodeHookCall } from '../../../ext/cc-tool-shapes'

/**
 * A conversation as Claude Code writes its transcript file: one JSON object per line, each a
 * `user` or `assistant` entry whose `message` is the Messages API shape. Hooks read it with
 * `jq` and `grep '"role":"assistant"'` (ralph-loop) or as plain text (hookify), so the lines are
 * compact JSON with Claude Code's field names, tool names and tool input shapes.
 *
 * What the person reads is what goes in: a message the model alone reads (`isInternal`), a
 * notice, a command's output or a blocked prompt is left out, as Claude Code keeps those out of
 * the conversation. An assistant message becomes one entry per model turn: its text and tool
 * calls, then a `user` entry with the results, as the API saw them.
 */
export interface CcTranscriptMeta {
  /** The `sessionId` every line carries: the id hooks get as `session_id`. */
  sessionId: string
  cwd: string
  /** Set for a subagent's own transcript (`isSidechain`, `agentId`). */
  agentId?: string
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }

/** A stable id, so rewriting an unchanged conversation rewrites the same lines. */
function uuidOf(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const shown = (message: PersistedMessage) => {
  const { payload } = message
  return !(
    payload.isInternal ||
    payload.uiOnly ||
    payload.promptBlocked ||
    payload.systemNotice ||
    payload.commandOutput ||
    payload.contextBoundary
  )
}

const resultOf = (item: ToolBackedItem) =>
  item.error?.userMessage ?? item.resultText ?? item.errorText ?? ''

/** One model turn's entries: the assistant's blocks, then the results its calls returned. */
function turnEntries(
  items: AgentItem[],
  cwd: string,
): { role: 'assistant' | 'user'; content: Block[] }[] {
  const said: Block[] = []
  const results: Block[] = []
  for (const item of items) {
    if (item.type === 'text' && item.text) said.push({ type: 'text', text: item.text })
    if (!isToolBackedItem(item)) continue
    const call = claudeCodeHookCall({ name: item.name }, item.input ?? {}, cwd)
    said.push({
      type: 'tool_use',
      id: item.toolCallId,
      name: call.tool_name,
      input: call.tool_input,
    })
    if (item.status === 'completed' || item.status === 'failed')
      results.push({
        type: 'tool_result',
        tool_use_id: item.toolCallId,
        content: resultOf(item),
        is_error: item.status === 'failed',
      })
  }
  return [
    ...(said.length > 0 ? [{ role: 'assistant' as const, content: said }] : []),
    ...(results.length > 0 ? [{ role: 'user' as const, content: results }] : []),
  ]
}

/** An assistant message's entries, one model turn at a time (`turnIndex`). */
function assistantEntries(message: PersistedMessage, cwd: string) {
  const items = message.payload.items ?? []
  if (items.length === 0) {
    const text = message.payload.content ?? ''
    return text ? [{ role: 'assistant' as const, content: [{ type: 'text', text } as Block] }] : []
  }
  const turns = new Map<number | undefined, AgentItem[]>()
  for (const item of items) turns.set(item.turnIndex, [...(turns.get(item.turnIndex) ?? []), item])
  return [...turns.values()].flatMap((turn) => turnEntries(turn, cwd))
}

/** The transcript lines of a conversation, oldest first, joined into the file's text. */
export function ccTranscriptText(
  messages: readonly PersistedMessage[],
  meta: CcTranscriptMeta,
): string {
  const lines: string[] = []
  let parentUuid: string | null = null
  for (const message of messages.filter(shown)) {
    const entries =
      message.payload.role === 'user'
        ? message.payload.content
          ? [{ role: 'user' as const, content: message.payload.content as string | Block[] }]
          : []
        : assistantEntries(message, meta.cwd)
    entries.forEach((entry, index) => {
      const uuid = uuidOf(`${message.id}:${index}`)
      const model = message.payload.turnEnd?.modelId ?? 'unknown'
      lines.push(
        JSON.stringify({
          parentUuid,
          isSidechain: meta.agentId !== undefined,
          userType: 'external',
          cwd: meta.cwd,
          sessionId: meta.sessionId,
          ...(meta.agentId ? { agentId: meta.agentId } : {}),
          type: entry.role,
          message:
            entry.role === 'assistant'
              ? {
                  id: `msg_${uuid.replaceAll('-', '')}`,
                  type: 'message',
                  role: 'assistant',
                  model,
                  content: entry.content,
                  stop_reason: null,
                }
              : { role: 'user', content: entry.content },
          uuid,
          timestamp: message.createdAt,
        }),
      )
      parentUuid = uuid
    })
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
