/**
 * Request-body schemas for `/rpc/agent-sessions`.
 *
 * These exist so that every mutating handler goes through `validated('json', …)` rather than
 * reading its own body. That is a SECURITY seam, not a validation convenience:
 * `validated('json')` requires the JSON content-type, which makes the request non-simple and
 * forces a CORS preflight that this app's localhost-only policy denies. `c.req.json()` enforces
 * nothing, so a cross-origin `text/plain` POST — a simple request, no preflight, sent by every
 * browser — would reach the handler from any page the user happens to have open.
 * See `apps/api/src/lib/route-body-contract.test.ts`, which measured exactly that.
 */

import { z } from 'zod'
import { AGENT_STATES } from '../shared/state'
import { MAX_ROSTER_LIMIT, MAX_STATS_DAYS, MAX_TRANSCRIPT_EVENTS } from '../shared/contracts'

/** The asking Localix session, when the caller has one. Bounded because it lands in log lines. */
const localixSessionId = z.string().min(1).max(200)

/** `<provider>:<nativeSessionId>`. Bounded because it lands in maps and log lines. */
const sessionKey = z.string().min(3).max(400)

const agentState = z.enum(AGENT_STATES)

export const rosterQuerySchema = z.object({
  text: z.string().max(400).optional(),
  providers: z.array(z.string().max(64)).max(32).optional(),
  states: z.array(agentState).max(AGENT_STATES.length).optional(),
  cwdPrefix: z.string().max(1024).optional(),
  // An exact model name, matched against a session's own model OR any model in its usage — the two
  // places providers record it. Bounded like a name, not like a body.
  model: z.string().max(200).optional(),
  /** A parent session's link key; bounded like the key it is. */
  parentKey: z.string().max(256).optional(),
  includeChildren: z.boolean().optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  limit: z.number().int().min(1).max(MAX_ROSTER_LIMIT).optional(),
})

export const rosterBodySchema = z.object({
  localixSessionId: localixSessionId.optional(),
  query: rosterQuerySchema.optional(),
})

/**
 * `/items` is `/transcript` projected onto the native `AgentItem` model, so it takes the same key
 * and the same event cap. There is no `maxCharsPerEvent`: the viewer renders whole items, and a
 * per-event clip would show a truncated tool result as if the provider had written one.
 */
export const itemsBodySchema = z.object({
  key: sessionKey,
  maxEvents: z.number().int().min(1).max(MAX_TRANSCRIPT_EVENTS).optional(),
  /**
   * Read the session's END rather than its opening. There is no `/transcript` route, so without
   * this the whole UI half of the plugin could only ever see openings while the model half chose
   * freely. Measured on a real local history: 10 of 230 sessions exceed the event cap, and those ten hold
   * 29,339 unreachable events — 30.6% of every event in the roster, all of it the recent end.
   */
  tail: z.boolean().optional(),
})

/** Statistics over discovered history — see backend/discovery/stats.ts. */
export const statsBodySchema = z.object({
  providers: z.array(z.string().min(1).max(64)).max(16).optional(),
  days: z.number().int().min(1).max(MAX_STATS_DAYS).optional(),
  includeChildren: z.boolean().optional(),
  // Same bounds as the roster's, because they are the same filters.
  cwdPrefix: z.string().max(1024).optional(),
  model: z.string().max(200).optional(),
})
