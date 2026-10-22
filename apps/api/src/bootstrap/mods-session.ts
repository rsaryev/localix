import type { PersistedMessage } from '../features/chat/contracts'
import type { ModSessionMessage, ModSessionRead } from '../features/mods/contracts'

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
    toolUses.push({ tool_use_id: item.toolCallId, tool: item.name, input: record(item.input) })
    if (item.status === 'completed' || item.status === 'failed')
      toolResults.push({
        tool_use_id: item.toolCallId,
        text: item.resultText ?? textOf('output' in item ? item.output : undefined),
        isError: item.status === 'failed',
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
  return {
    messages: visible.map(messageOf),
    model,
    ...(context ? { context } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}
