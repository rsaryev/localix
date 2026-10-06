/**
 * Wire shapes for the plugin's `/rpc` surface.
 *
 * This module used to DECLARE a second, hand-kept copy of every contract "while `shared/` was still
 * moving". `shared/` has settled, and a second copy of a contract is a copy that drifts in silence:
 * the UI would go on compiling against fields the backend stopped sending. So it is now a
 * re-export — every call site keeps importing `../model/types`, and there is one definition.
 */
import type { AgentItem } from '@localixai/agent/agents'

export { AGENT_STATES } from '../../shared/state'
export {
  bindingQuota,
  formatQuota,
  quietMinutes,
  MAX_ROSTER_LIMIT,
  QUOTA_WARN_PERCENT,
  quotaIsCurrent,
} from '../../shared/contracts'
export type {
  AgentState,
  Bounded,
  ExternalAgentStats,
  ProviderId,
  ProviderStatus,
  QuotaReading,
  RosterQuery,
  RosterRow,
  SessionSummary,
  StatBucket,
  StateAuthority,
  StateExplain,
  StatsQuery,
} from '../../shared/contracts'

/**
 * The `POST /items` response. Declared here rather than in `shared/contracts` because it is the
 * shape of a ROUTE, not of the domain: `routes.ts` assembles it inline from a `TranscriptSlice`
 * plus the item projection, and nothing on the backend names it either.
 *
 * `withheld`/`total` count EVENTS, not items — the projection folds an adjacent call/result pair
 * into one item, so item count and event count are deliberately different numbers.
 */
/** One speaker's uninterrupted stretch, as the backend projects it. */
export interface TranscriptTurn {
  readonly role: 'user' | 'assistant'
  readonly items: readonly AgentItem[]
}

export interface AgentItemsSlice {
  readonly key: string
  readonly turns: readonly TranscriptTurn[]
  readonly withheld: number
  readonly total: number
  /** Present only when the provider adapter declares native session continuation. */
  readonly resume?: { readonly providerName: string; readonly command: string }
  /** The adapter's byte cap cut the source, so `total` is a floor — see `shared/contracts.ts`. */
  readonly sourceTruncated?: boolean
}
