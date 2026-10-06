import { z } from 'zod'
import { AGENT_SESSIONS_ACTIONS, type AgentSessionsInput } from './tools/agent-sessions-schema'
import { AGENT_STATES } from '../shared/state'
import { MAX_TRANSCRIPT_EVENTS, MAX_STATS_DAYS } from '../shared/contracts'
import { MAX_WAIT_MS, MIN_WAIT_MS } from './live/waiters'

/** Compact snake_case model contract; HTTP and domain contracts retain their typed field names. */
export const externalAgentInputSchema = z.object({
  action: z.enum(AGENT_SESSIONS_ACTIONS),
  key: z
    .string()
    .max(400)
    .optional()
    .describe('provider:nativeSessionId from roster or linked context.'),
  keys: z.array(z.string().max(400)).max(32).optional(),
  text: z.string().max(400).optional(),
  providers: z.array(z.string()).optional(),
  cwd_prefix: z.string().max(1024).optional(),
  model: z.string().max(200).optional(),
  parent_key: z.string().max(400).optional(),
  states: z.array(z.enum(AGENT_STATES)).optional(),
  include_children: z.boolean().optional(),
  days: z.number().int().min(1).max(MAX_STATS_DAYS).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(40).optional(),
  mode: z.enum(['one', 'any', 'all']).optional(),
  until: z.array(z.enum(AGENT_STATES)).optional(),
  timeout_ms: z.number().int().min(MIN_WAIT_MS).max(MAX_WAIT_MS).optional(),
  max_events: z.number().int().min(1).max(MAX_TRANSCRIPT_EVENTS).optional(),
  tail: z
    .boolean()
    .optional()
    .describe('Transcript: opening by default; context: latest by default.'),
  from: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Transcript event position; cannot combine with tail.'),
  budget_chars: z.number().int().min(2000).max(400_000).optional(),
})

export function agentSessionsInput(
  input: z.infer<typeof externalAgentInputSchema>,
): AgentSessionsInput {
  const {
    cwd_prefix,
    parent_key,
    include_children,
    timeout_ms,
    max_events,
    budget_chars,
    ...shared
  } = input
  return {
    ...shared,
    cwdPrefix: cwd_prefix,
    parentKey: parent_key,
    includeChildren: include_children,
    timeoutMs: timeout_ms,
    maxEvents: max_events,
    budgetChars: budget_chars,
  }
}
