import { z } from 'zod'

import { TOOL } from './tool-names'

const agentRefs = z
  .array(z.string().trim().min(1))
  .describe('Agent IDs or handles, with or without @.')

// No `action` field: the tool does one thing, and a required `action:"finish_turn"` was a
// constant every call had to spell (and every follow-up prompt had to teach) for nothing.
export const conversationControlRequestSchema = z
  .object({
    next: agentRefs.describe('Who runs next. [] queues nobody.'),
    invite: agentRefs.optional().describe('Available agents to add to this conversation.'),
    remove: agentRefs.optional().describe('Participants whose work here is done.'),
  })
  .strict()

export type ConversationControlRequest = z.infer<typeof conversationControlRequestSchema>

export interface CompletedConversationControl {
  toolCallId: string
  request: ConversationControlRequest
}

export function completedConversationControl(
  items: readonly unknown[] | undefined,
): CompletedConversationControl | undefined {
  for (const item of [...(items ?? [])].reverse()) {
    if (!item || typeof item !== 'object') continue
    const call = item as {
      id?: unknown
      toolCallId?: unknown
      type?: unknown
      name?: unknown
      status?: unknown
      input?: unknown
      error?: unknown
    }
    if (
      call.type !== 'tool_call' ||
      call.name !== TOOL.conversation_control ||
      call.status !== 'completed' ||
      call.error
    )
      continue
    const parsed = conversationControlRequestSchema.safeParse(call.input)
    const toolCallId =
      typeof call.toolCallId === 'string'
        ? call.toolCallId
        : typeof call.id === 'string'
          ? call.id
          : undefined
    if (parsed.success && toolCallId) return { toolCallId, request: parsed.data }
  }
  return undefined
}
