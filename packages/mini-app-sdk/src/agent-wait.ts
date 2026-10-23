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

/** "12s", "1m 05s" — how long the other side has been thinking. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
