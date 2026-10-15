import { z } from 'zod'

/**
 * What a board shows after it asked the agent for a turn: `thinking` — the chat was woken (or is
 * already playing); `unreachable` — the wake did not land, with the host's `reason`. Shared by the
 * backend that records it and the view that renders it.
 */
export const agentWaitSchema = z.object({
  since: z.string(),
  status: z.enum(['thinking', 'unreachable']),
  reason: z.string().optional(),
})
export type AgentWait = z.infer<typeof agentWaitSchema>
