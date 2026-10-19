// Usage-ledger row/aggregate/dashboard type contracts. Extracted from the
// repository so the query implementation stays focused on SQL.

/** Input for one usage-ledger row: a chat turn or a stable auxiliary-call bucket. */
export interface UsageEventInput {
  messageId: string
  sessionId: string
  rootSessionId?: string | null
  userId: string
  /** Original request timestamp. Omitted for live writes (SQLite CURRENT_TIMESTAMP). */
  createdAt?: string
  providerConnectionId?: string | null
  /** Catalog provider id, e.g. 'openrouter' — denormalized for fast grouping. */
  providerId?: string | null
  modelId: string
  /** The party member that produced the request — the "who" a room's model id no longer gives. */
  agentId?: string | null
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheWrite1hTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  costUsd?: number
  /** 'actual' = provider-reported billed cost; 'estimated' = catalog-computed;
   *  'subscription' = OAuth plan (catalog estimate, not metered spend). */
  costSource?: 'actual' | 'estimated' | 'subscription'
  /** Why the run's final turn stopped (end_turn / tool_use / max_tokens / …). */
  finishReason?: string | null
  /** True model time for the run (ms) — drives the tokens/sec readout in logs. */
  durationMs?: number | null
  /** The API key that produced this request (denormalized snapshot). */
  keyId?: string | null
  keyLabel?: string | null
  keyMasked?: string | null
}

/** One aggregated row from queryStats (keyed by model id or provider id). */
export interface UsageStatRow {
  key: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  messages: number
  /** How many of the aggregated rows had provider-reported (actual) cost. */
  actualCostMessages: number
  /** How many of the aggregated rows were OAuth-subscription turns. */
  subscriptionMessages: number
  /** Subscription-plan API-equivalent portion of costUsd. */
  subscriptionCostUsd: number
}

/** One authoritative vocabulary for ledger call-kind aggregation and presentation. */
export const USAGE_AUXILIARY_KINDS = [
  'title',
  'autocomplete',
  'inline-completion',
  'terminal',
  'improve',
  'classify',
  'hook',
  'routing',
] as const

export type UsageKindKey = 'turn' | (typeof USAGE_AUXILIARY_KINDS)[number]

export const USAGE_KIND_LABELS: Readonly<Record<UsageKindKey, string>> = {
  turn: 'Chat turns',
  title: 'Titles',
  autocomplete: 'Autocomplete',
  'inline-completion': 'Inline completion',
  terminal: 'Terminal',
  improve: 'Prompt improvement (retired)',
  classify: 'Auto-mode classifier',
  hook: 'Hook policy checks',
  routing: 'Group routing',
}

/** Grand totals for the dashboard summary cards. */
export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  messages: number
  actualCostMessages: number
  /** How many of the aggregated rows were OAuth-subscription turns
   *  (catalog-estimated API-equivalent, not metered per token). */
  subscriptionMessages: number
  subscriptionCostUsd: number
}

/** One time bucket for the spend-over-time chart. */
export interface UsageTrendPoint {
  day: string
  totalTokens: number
  costUsd: number
  messages: number
}

/** Combined dashboard payload — one round-trip for the whole top section. */
export interface UsageOverview {
  summary: UsageSummary
  stats: UsageStatRow[]
  trend: UsageTrendPoint[]
}

/** One per-run row for the request-logs table. */
export interface UsageLogRow {
  messageId: string
  createdAt: string
  sessionId: string
  sessionTitle: string | null
  modelId: string
  providerId: string | null
  /** Which participant spent it; null for rows with no speaker (auxiliary calls, legacy). */
  agentId: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  totalTokens: number
  costUsd: number
  costSource: string
  finishReason: string | null
  durationMs: number | null
  /** 'byok' (user API key) | 'credits' (oauth) | 'unknown'. */
  usageKind: 'byok' | 'credits' | 'unknown'
  /** Label of the API key that produced this request (denormalized). */
  keyLabel: string | null
  /** Masked preview of that key (e.g. "…4f2a"). */
  keyMasked: string | null
}

export interface UsageLogsPage {
  rows: UsageLogRow[]
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null
}

/** Distinct filter values for the dashboard (models/providers used, sessions with usage). */
export interface UsageKeys {
  models: string[]
  providers: string[]
  sessions: { id: string; title: string | null }[]
  /** Agents that have spent anything, with the handle the party recorded for them. */
  agents: { id: string; handle: string | null }[]
}

/**
 * The dimensions the dashboard's breakdown groups spend by. `agent` is the only one that
 * answers "who spent it" in a room, where one session runs several participants.
 */
export type UsageGroupBy = 'model' | 'provider' | 'kind' | 'agent'

/** Shared filter set across the dashboard queries. */
export interface UsageFilters {
  userId: string
  from?: string
  to?: string
  model?: string
  provider?: string
  /** Exactly this session's own rows. What the dashboard means by "this session". */
  session?: string
  /** One party member's rows, across every session it took part in. */
  agent?: string
  /**
   * This session AND everything under it — every delegated sub-agent, delegated task run and
   * subsession loop round.
   *
   * A separate filter rather than a change to `session`, because the two answer different
   * questions and both are wanted: the dashboard lists sessions individually, so a child's
   * spend belongs to the child's own row there. But anything BOUNDING a session's work has to
   * see the whole tree, since a child's tokens land on the child's `session_id` while the
   * work was done for the parent's objective. Rolling up is sound because `root_session_id` is
   * inherited from the parent's root, so it names the top of the tree even for a grandchild.
   */
  sessionTree?: string
}
