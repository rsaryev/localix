import type { ModSessionMessage } from '../contracts'

/**
 * `$.session.messages` as Claude Code answers it: the newest 4096 entries, as rows
 * (`{ role, text, toolUses }`), or with `as: 'api'` as Messages API messages whose blocks are
 * intact and whose first message is the user's. A tool's result travels in the user message after
 * the assistant message that called it.
 */

export const MAX_MESSAGES = 4096

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: { type: string; [field: string]: unknown }[]
}

export const newestRows = (messages: readonly ModSessionMessage[]) => messages.slice(-MAX_MESSAGES)

export function apiMessagesOf(messages: readonly ModSessionMessage[]): ApiMessage[] {
  const out: ApiMessage[] = []
  for (const message of messages) {
    const text = message.text ? [{ type: 'text', text: message.text }] : []
    if (message.role === 'user') {
      const results = (message.toolResults ?? []).map(resultBlock)
      // The API rejects a message with no content: a row with nothing to send is skipped.
      if (results.length + text.length) out.push({ role: 'user', content: [...results, ...text] })
      continue
    }
    const uses = message.toolUses.map((use) => ({
      type: 'tool_use',
      id: use.tool_use_id,
      name: use.tool,
      input: use.input,
    }))
    if (text.length + uses.length) out.push({ role: 'assistant', content: [...text, ...uses] })
    // Localix records a call's result beside the call; the API form pairs it in the next message.
    if (message.toolResults?.length)
      out.push({ role: 'user', content: message.toolResults.map(resultBlock) })
  }
  const kept = out.slice(-MAX_MESSAGES)
  const first = kept.findIndex((message) => message.role === 'user')
  return first < 0 ? [] : kept.slice(first)
}

const resultBlock = (result: NonNullable<ModSessionMessage['toolResults']>[number]) => ({
  type: 'tool_result',
  tool_use_id: result.tool_use_id,
  content: result.text,
  is_error: result.isError,
})
