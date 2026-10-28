import { z } from 'zod'

import { clientToolSurfaceSchema } from './session'
import { MAX_MESSAGE_BINDINGS_TOTAL_BYTES } from './message-binding-bytes'
import { messageBindingsSchema } from './message-bindings-input'

export { MAX_MESSAGE_BINDINGS_TOTAL_BYTES }
export { messageBindingsSchema }
export type {
  MessageAttachment,
  MessageBinding,
  MessageContextBinding,
  MessageInvocationBinding,
} from '@localixai/agent'

/** Per-message binding guards: cap count and total encoded payload (~25MB). */
export const sendMessageRequestSchema = z
  .object({
    prompt: z.string().trim(),
    /**
     * Ephemeral client transcript identity used only to correlate a busy-send's
     * durable queue row with its optimistic UI row. It is never a persisted
     * message id and older/non-UI clients may omit it.
     */
    clientMessageId: z.string().min(1).max(160).optional(),
    /** Capabilities of the client surface initiating this turn. */
    toolSurface: clientToolSurfaceSchema.optional(),
    bindings: messageBindingsSchema.optional(),
    /**
     * Hide the user turn in the transcript (the model still sees it) — for MACHINE-COMPOSED
     * prompts the user triggered but did not type, e.g. an extension-owned analysis wizard:
     * the intent was collected in UI controls, so echoing the wall of task text adds nothing.
     */
    isInternal: z.boolean().optional(),
  })
  // The active tab's context rides every composer send on its own; it is never a message the
  // person wrote, so text-less it must not start (or queue) a turn.
  .refine(
    (v) =>
      v.prompt.length > 0 ||
      (v.bindings ?? []).some(
        (binding) => !('source' in binding && binding.source === 'active-tab'),
      ),
    { message: 'Message must include text or a binding' },
  )

/**
 * Unified tool interaction endpoint.
 *
 * action:
 *   'kill'     — abort a running bash/process tool (payload ignored)
 *   'respond'  — answer a HITL prompt         (payload: { answers: unknown })
 *   'dismiss'  — cancel a HITL prompt         (payload ignored)
 *   <custom>   — any action registered via AsyncToolRegistry
 *
 * toolCallId doubles as the HITL requestId for ask/quiz tools (they are the same value).
 */
export const toolInteractSchema = z.object({
  toolCallId: z.string().min(1),
  action: z.string().min(1),
  payload: z.unknown().optional(),
})

export interface MessageMutationResponse {
  sessionId: string
  messageId: string
  /** Queued behind an in-flight run. `messageId` is empty until `message.created` arrives. */
  queued?: true
  /** The line answered the session's open `ask` card; no turn was started or queued. */
  answeredInteraction?: true
}

export interface RollbackResponse {
  restoredPrompt: string
}
