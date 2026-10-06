import type { ProviderId } from './identity'
import type { TokenUsage } from './contracts'

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
// The SHAPE lives here with the other wire types; the FOLD that produces it lives in
// backend/discovery/stats.ts. These were declared twice — once there and once in the UI's
// `model/types.ts` — which is the arrangement that file's own header warns about, and it had
// already cost a change that had to be applied to both copies by hand to stay honest.
//
// Usage is provider-reported only. Cost remains deliberately absent: Codex and Claude Code local
// logs record tokens/model but not a charged amount, and applying today's API price to a
// subscription session would be an estimate wearing the clothes of billing.

/** Default window when a caller names none. */
export const DEFAULT_STATS_DAYS = 30
/** Widest window a caller may ask for. A wire bound: the request schemas validate against it. */
export const MAX_STATS_DAYS = 365

/** One bucket of a distribution — provider, project, or day. */
export interface StatBucket {
  readonly key: string
  /**
   * Human name for the bucket when its key is not one — a session key names nothing a reader
   * recognises. Absent on the axes whose key IS the label (a provider id, a model, a path, a day).
   */
  readonly label?: string
  readonly sessions: number
  /** Absent when no session in the bucket reports a message count — see the note on `messages`. */
  readonly messages?: number
  /** Absent when no session in the bucket carries provider-reported usage. */
  readonly usage?: TokenUsage
  /** Most recent activity in the bucket, so a list can be ordered by relevance rather than size. */
  readonly updatedAt: number
}

export interface ExternalAgentStats {
  /** Sessions in the window — as is every count here except the `firstAt`/`lastAt` span. */
  readonly sessions: number
  /**
   * Total messages, ABSENT when no adapter reported one.
   *
   * `SessionSummary.messageCount` is optional and today no adapter fills it: a summary is a bounded
   * head+tail read, and counting a transcript's records means reading all of it — the cost the
   * whole index exists to avoid. Reporting `0` here would be a measurement nobody took, so the
   * field is simply absent and the UI omits the tile rather than showing a confident zero.
   */
  readonly messages?: number
  /** Measured consumption inside the selected time window. */
  readonly usage?: TokenUsage
  /** Sessions contributing to `usage`; makes partial provider/history coverage visible. */
  readonly usageSessions: number
  /** Distinct working directories in the window, UNCAPPED — `byProject` lists only the top few. */
  readonly projects: number
  /**
   * First and last activity across ALL history, not just the window.
   *
   * The one all-time fact worth keeping on a windowed screen: it says how far back there is
   * anything to ask for, which a window-scoped figure could only restate as the window itself.
   */
  readonly firstAt?: number
  readonly lastAt?: number
  /** Median wall-clock span of the sessions that record both ends. */
  readonly medianDurationMs?: number
  /** Sessions per agent. NOT narrowed by a `providers` drill — see `computeStats`. */
  readonly byProvider: readonly StatBucket[]
  readonly byProject: readonly StatBucket[]
  readonly byModel: readonly StatBucket[]
  /**
   * The heaviest individual sessions in the window, bounded by `STATS_SESSION_LIMIT`.
   *
   * Every other axis AGGREGATES, which hides how concentrated the spend is: measured on this
   * machine, 10 sessions out of 212 account for 53% of all tokens and the single heaviest for 14.9%,
   * while `byProject` folds 151 of those sessions into one bar. "Which runs cost the most" is a
   * question none of the other axes can answer.
   *
   * Each bucket's `key` is the session key, so it addresses the same session every other surface
   * does, and its `label` is the title a reader recognises.
   */
  readonly topSessions: readonly StatBucket[]
  /**
   * The sessions that delegated most, by how many sub-agent transcripts name them as parent.
   *
   * Measured on a real local history: 1,283 of 1,535 sessions are children, and they belong to just 55
   * parents — the widest spawned 208, the median parent 8. Every other axis here answers "what did
   * this cost"; this one answers "what did it FAN OUT to", which is the question an orchestrator
   * has and the one figure the screen could not produce.
   *
   * Counted over every child on disk, not over the window's selection: a parent inside the window
   * whose children are older would otherwise read as having delegated nothing. `sessions` on each
   * bucket is the child count, which is what the bar length means here.
   */
  readonly byParent: readonly StatBucket[]
  /**
   * Agents that HAVE history but none of it inside the window, with their all-time session count and
   * the newest thing they did. Computed where the window is applied, because both surfaces need it and
   * neither can derive it from a windowed result: an agent with nothing in range leaves no bar and no
   * row, so its absence is indistinguishable from never having existed.
   *
   * Measured on a real local history with the 30-day default: four of six providers land here, holding 105
   * sessions. It respects the provider filter, like every figure here except the agent axis.
   */
  readonly outsideRange: readonly StatBucket[]
  /**
   * Days inside the window that hold at least one session.
   *
   * The trend draws every bucket including the empty ones, which is right — a gap is information — but
   * it leaves a reader dividing a total by the window's LENGTH when the divisor they mean is this.
   * Measured here: 29 of 30 days at the default range, and 37 of 90 at the widest, so the same total
   * spread over 90 days is 2.4x denser than it looks. Named after CodexBar's `coveredDayCount`, which
   * carries the same figure in its shared-stats payload for the same reason.
   */
  readonly activeDays: number
  /** Trend buckets, oldest first, INCLUDING empty ones. Daily for short windows, weekly for long
   *  ones — see `bucketDays`. */
  readonly byDay: readonly StatBucket[]
  /** Days per trend bucket, so a reader knows whether a bar is a day or a week. */
  readonly bucketDays: number
}

export interface StatsQuery {
  /** Restrict to these providers; empty/absent means every provider. */
  readonly providers?: readonly ProviderId[]
  /** Days back from `now`. Scopes every figure except the `firstAt`/`lastAt` history span. */
  readonly days?: number
  readonly includeChildren?: boolean
  /** The same filter the roster takes, so one selection narrows both surfaces. */
  readonly model?: string
  /**
   * Restrict to sessions whose cwd starts with this.
   *
   * `RosterQuery` has had it since the roster existed and NOTHING ever sent one — not the workspace,
   * not the tool — so a filter declared in the contract, validated by the route and implemented in the
   * fold was unreachable from either half. The project axis is the natural way in, and it now drills
   * exactly as the agent axis does.
   */
  readonly cwdPrefix?: string
}
