/**
 * The model-facing contract for the `external_agent_sessions` tool.
 *
 * Follows the repo's schema-module convention (exemplar: `trading/backend/manage-chart-schema.ts`):
 * one flat `z.object` with an `action` enum and per-action optional params, `.describe()` on every
 * field, and a pure `*Problem()` helper that answers a malformed call with a fix-it message before
 * the body runs.
 */

import type { z as Zod } from 'zod'
import {
  DEFAULT_STATS_DAYS,
  MAX_ROSTER_LIMIT,
  MAX_STATS_DAYS,
  MAX_TRANSCRIPT_EVENTS,
} from '../../shared/contracts'
import { AGENT_STATES } from '../../shared/state'
import { MAX_WAIT_MS, MIN_WAIT_MS } from '../live/waiters'

export const AGENT_SESSIONS_ACTIONS = [
  'providers',
  'roster',
  'stats',
  'explain',
  'transcript',
  'context',
  'wait',
] as const

export type AgentSessionsAction = (typeof AGENT_SESSIONS_ACTIONS)[number]

/** Most keys one "wait"/"context" call may name. */
export const MAX_SESSION_KEYS = 32

export function buildAgentSessionsSchema(z: typeof Zod) {
  return z.object({
    action: z
      .enum(AGENT_SESSIONS_ACTIONS)
      .describe(
        'What to do. "roster" lists external agent sessions (live and historical) — start here, every other action takes a key from it, and each row carries its event count so you can tell what reading it will cost. "wait" blocks until listed agents reach a state. "context" pulls transcripts from several sessions at once. "transcript" reads one. "stats" summarises them by agent, project and model, with the tokens each consumed — ask it when a count answers the question better than a list of hundreds.',
      ),
    key: z
      .string()
      .optional()
      .describe(
        'A single session key in the form "<provider>:<nativeSessionId>", exactly as returned by "roster". A native id alone is NOT accepted: ids are only unique within a provider.',
      ),
    // Bounded: each key costs a full source walk, and they run at once — an unbounded list was
    // an unbounded fan-out of filesystem scans.
    keys: z
      .array(z.string())
      .max(MAX_SESSION_KEYS)
      .optional()
      .describe(
        'Several session keys, for "wait" and "context". Each is a "<provider>:<nativeSessionId>" pair.',
      ),
    text: z
      .string()
      .optional()
      .describe(
        'Free-text filter for "roster" — matches title, cwd, provider, id and the full key, so a key copied from any other answer can be pasted straight in. Every whitespace-separated term must match.',
      ),
    providers: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict "roster" to these providers. Filtering here also makes the scan cheaper.',
      ),
    cwdPrefix: z
      .string()
      .max(1024)
      .optional()
      .describe(
        'Restrict "roster" and "stats" to sessions whose working directory starts with this. A PREFIX, so a repository selects its own subtrees too — the way to ask "which agents worked in this project" without matching the path as free text. Composes with "providers" rather than replacing it.',
      ),
    model: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Restrict "roster" and "stats" to sessions that ran on this model. Matches a session\'s own recorded model OR any model inside its token usage — providers record it in one of those two places, never both, so pass an exact name: read one off the "By model" axis of "stats".',
      ),
    parentKey: z
      .string()
      .max(256)
      .optional()
      .describe(
        'Restrict "roster" to the sub-agents a session spawned, given that session\'s key. Sub-agent transcripts are hidden by default and outnumber top-level sessions several to one, so this filter overrides that default rather than being narrowed by it. The "stats" action ranks the sessions that delegated most, and its keys are what to pass here.',
      ),
    states: z
      .array(z.enum(AGENT_STATES))
      .optional()
      .describe('Restrict "roster" to these lifecycle states.'),
    includeChildren: z
      .boolean()
      .optional()
      .describe(
        'Include sub-agent transcripts. Off by default: they outnumber top-level sessions several to one.',
      ),
    days: z.number().int().min(1).max(MAX_STATS_DAYS).optional().describe(
      // Said precisely because it stopped being true of the trend alone: the window scopes every
      // figure `stats` returns except the all-time history span.
      `For "stats": the window every figure covers, in days back from now (default ${DEFAULT_STATS_DAYS}). The reported history span is all-time regardless.`,
    ),
    offset: z.number().int().min(0).optional().describe('Row offset for "roster" paging.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ROSTER_LIMIT)
      .optional()
      .describe('Maximum rows for "roster" (default 200).'),
    mode: z
      .enum(['one', 'any', 'all'])
      .optional()
      .describe(
        'For "wait": "any" returns when the FIRST listed session reaches a target state; "all" returns when every one has. Default "any".',
      ),
    until: z
      .array(z.enum(AGENT_STATES))
      .optional()
      .describe(
        'For "wait": the target states. Default is idle, done or blocked — the settled states.',
      ),
    timeoutMs: z
      .number()
      .int()
      .min(MIN_WAIT_MS)
      .max(MAX_WAIT_MS)
      .optional()
      .describe('For "wait": timeout in ms (default 120000).'),
    maxEvents: z
      .number()
      .int()
      .min(1)
      .max(MAX_TRANSCRIPT_EVENTS)
      .optional()
      .describe('For "transcript": cap on returned events.'),
    tail: z.boolean().optional().describe(
      // The defaults differ per action on purpose — see the note on `service.context`. Said here
      // because a caller cannot see which end it got: both ends render identically.
      'Which END of a session to read. Costs the same either way. For "transcript" the default is the OPENING (what the agent was asked); pass true for what it did most recently. For "context" the default is already the LATEST, because naming several sessions at once asks where they got to — pass false there for their openings. Every section states which positions it holds.',
    ),
    from: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'For "transcript": start at this POSITION instead of the session\'s start. Positions are the ones every answer already reports. It is the only way to reach the middle of a session past the event cap — on a 11,332-event session, a head read and a tail read together still leave thousands of events unreachable. Not combinable with "tail".',
      ),
    budgetChars: z
      .number()
      .int()
      .min(2000)
      .max(400_000)
      .optional()
      .describe(
        'For "context": total character budget across ALL requested transcripts (default 120000).',
      ),
  })
}

export type AgentSessionsInput = Zod.infer<ReturnType<typeof buildAgentSessionsSchema>>

/**
 * Answer a malformed call with the fix rather than an error. Returning the corrective sentence
 * costs one turn; a raw validation failure costs several.
 */
export function agentSessionsProblem(input: AgentSessionsInput): string | null {
  const needsKey: AgentSessionsAction[] = ['explain', 'transcript']
  const needsKeys: AgentSessionsAction[] = ['wait', 'context']

  if (needsKey.includes(input.action) && !input.key) {
    return `The "${input.action}" action needs a "key". Run { action: "roster" } first and copy a row's "key" field (it looks like "claude-code:0c61aa4b-...").`
  }
  if (needsKeys.includes(input.action) && (!input.keys || input.keys.length === 0)) {
    return `The "${input.action}" action needs a non-empty "keys" array. Run { action: "roster" } and copy the "key" of every session you mean.`
  }
  if (input.key && !input.key.includes(':')) {
    return `"${input.key}" is not a session key. A key is "<provider>:<nativeSessionId>" — a native id on its own is ambiguous because ids are only unique within one provider. Get the full key from { action: "roster" }.`
  }
  for (const key of input.keys ?? []) {
    if (!key.includes(':')) {
      return `"${key}" in "keys" is not a session key. Each entry must be "<provider>:<nativeSessionId>", as returned by { action: "roster" }.`
    }
  }
  if (input.from !== undefined && input.tail === true) {
    return 'A "from" position and "tail" ask for opposite things — one starts at a position, the other at the end. Drop "tail" to read forward from "from", or drop "from" to read the end.'
  }
  if (input.from !== undefined && input.action !== 'transcript') {
    return `"from" applies to "transcript" only; "${input.action}" has no position to start from.`
  }
  if (input.action === 'wait' && input.mode === 'one' && (input.keys?.length ?? 0) > 1) {
    return 'mode "one" waits on a single session but several keys were given. Use mode "any" to return on the first, or "all" to wait for every one.'
  }
  return null
}
