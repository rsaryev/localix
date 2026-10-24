import type { PersistedMessage } from '../features/chat/contracts'
import {
  claudeCodeHookCall,
  claudeCodeToolName,
  claudeCodeToolResponse,
} from '../features/ext/cc-tool-shapes'
import type { ModSessionMessage, ModSessionRead } from '../features/mods/contracts'

/** A call's input in Claude Code's fields, as the conversation recorded it. */
const toClaudeInput = (tool: string, input: Record<string, unknown>) =>
  record(claudeCodeHookCall({ name: tool }, input).tool_input)

/**
 * A conversation as `$.session` reads it (`features/mods`), from the transcript chat stores: each
 * visible message's text, the tools it called and what they returned, the latest measured context
 * window, and the sum of what its runs cost.
 */

const CONTEXT_WINDOW = 'data-context-window'

interface ContextWindow {
  fullWindowTokens?: number
  policyWindowTokens?: number
  activeTokens?: number
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)

function messageOf(message: PersistedMessage): ModSessionMessage {
  const { payload } = message
  const toolUses: ModSessionMessage['toolUses'] = []
  const toolResults: NonNullable<ModSessionMessage['toolResults']> = []
  for (const item of payload.items ?? []) {
    if (!('toolCallId' in item)) continue
    const input = record(item.input)
    const done = item.status === 'completed' || item.status === 'failed'
    const text = item.resultText ?? textOf('output' in item ? item.output : undefined)
    // The result as Claude Code's tool records it, and the text the model read.
    const result = done
      ? record(claudeCodeToolResponse({ name: item.name }, { content: text }, input))
      : undefined
    toolUses.push({
      tool_use_id: item.toolCallId,
      tool: claudeCodeToolName({ name: item.name }, input),
      input: toClaudeInput(item.name, input),
      ...(done ? { result, text } : {}),
    })
    if (done)
      toolResults.push({
        tool_use_id: item.toolCallId,
        text,
        isError: item.status === 'failed',
        result,
      })
  }
  return {
    role: payload.role,
    text: payload.content ?? '',
    toolUses,
    ...(toolResults.length > 0 ? { toolResults } : {}),
  }
}

export function sessionReadOf(
  messages: readonly PersistedMessage[],
  model: string | null,
): ModSessionRead {
  const visible = messages.filter((message) => !message.payload.isInternal)
  let context: ModSessionRead['context']
  let costUsd: number | undefined
  for (const { payload } of visible) {
    const window = [...(payload.dataParts ?? [])]
      .reverse()
      .find((part) => part.type === CONTEXT_WINDOW)
    if (window) {
      const data = window.data as ContextWindow
      const size = data.policyWindowTokens ?? data.fullWindowTokens
      if (size)
        context = {
          window: size,
          ...(data.activeTokens !== undefined ? { tokens: data.activeTokens } : {}),
        }
    }
    if (typeof payload.usage?.totalCost === 'number')
      costUsd = (costUsd ?? 0) + payload.usage.totalCost
  }
  const first = visible[0]?.createdAt
  const startedAt = first ? Date.parse(first) : Number.NaN
  return {
    messages: visible.map(messageOf),
    model,
    ...(Number.isFinite(startedAt) ? { startedAt } : {}),
    ...(context ? { context } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}
