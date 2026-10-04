/**
 * Wire + domain contracts shared by the backend and the UI.
 *
 * Shapes follow a normalized agent-history contract wherever there is a match, so that another
 * source can populate the same rows: `provider` is first-class on every record, sessions carry
 * provenance (`sourcePath`), and events carry a role + timestamp + optional touched files. The
 * storage internals of any one history backend are deliberately NOT mirrored here.
 */

import type { AgentState, StateAuthority, StateExplain } from './state'
import type { ProviderId } from './identity'
import { linkKeyOf } from './identity'

/** One external agent session as it appears in the roster. */
export interface SessionSummary {
  /** `linkKeyOf({provider, nativeSessionId})` — the primary key. */
  readonly key: string
  readonly provider: ProviderId
  readonly nativeSessionId: string
  readonly title: string
  /** Working directory the session ran in, when the provider records one. */
  readonly cwd?: string
  readonly startedAt?: number
  readonly updatedAt: number
  readonly messageCount?: number
  /**
   * Provider-reported model consumption.
   *
   * This is measured from the provider's own history, never estimated from characters. Input is
   * normalized to EXCLUDE cache reads/writes so the components add back up to `totalTokens`.
   */
  readonly usage?: SessionTokenUsage
  /**
   * The model this session ran on, where the provider records ONE per session.
   *
   * Absent for providers that switch models mid-session — Claude Code and Codex both do, and
   * `usage.byModel` already carries that faithfully. It exists because the model axis was derived from
   * token usage alone, so a provider reporting no tokens contributed no models at all: GitHub
   * Copilot's 34 sessions and 5,541 messages here left the axis empty and the tile reading "0 models",
   * which is a claim about models rather than about measurement.
   */
  readonly model?: string
  /** The last reading of each window this session's own log recorded, when its provider records any. */
  readonly quotas?: readonly QuotaReading[]
  /** Provenance: the file (or db) this row was read from. Always shown, never guessed. */
  readonly sourcePath: string
  /** Native parent session, when the provider models sub-sessions (Codex, opencode both do). */
  readonly parentNativeSessionId?: string
}

/** Additive token/request counters shared by a session, model, day, or chart bucket. */
export interface TokenUsage {
  /** Non-cached prompt tokens. */
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  /** Subset of output where the provider reports it separately. */
  readonly reasoningTokens: number
  readonly totalTokens: number
  readonly requests: number
}

/** One model's contribution to a session or day. */
export interface ModelTokenUsage extends TokenUsage {
  readonly model: string
}

/** One UTC day of provider-reported consumption. */
export interface DailyTokenUsage extends TokenUsage {
  /** `YYYY-MM-DD`. */
  readonly day: string
  readonly byModel: readonly ModelTokenUsage[]
}

/** All measured consumption attached to one provider session. */
export interface SessionTokenUsage extends TokenUsage {
  readonly byModel: readonly ModelTokenUsage[]
  /**
   * Daily request attribution. This keeps a 30-day view from charging a long session's entire
   * lifetime to the day on which its transcript was last touched.
   */
  readonly byDay: readonly DailyTokenUsage[]
}

/** A roster row = a session plus what we know about its liveness. */
export interface RosterRow extends SessionSummary {
  readonly state: AgentState
  readonly authority: StateAuthority
  /** Present only while a live delegation is attached. */
  readonly terminalId?: string
  /** An orchestrator is blocked on this session right now — see backend/live/waiters.ts. */
  readonly awaited?: boolean
  /**
   * The state is the manifest's NO-MATCH fallback, not a reading. `authority` cannot carry this:
   * a matched rule and the fallback are both `screen-manifest`, so without this field an `idle`
   * that nothing confirmed is indistinguishable from an observed one. It is not a rare corner —
   * claude-code's only `working` rule needs its `/btw` overlay open (8 rules; the rest yield
   * `blocked` or `unknown`), so an ordinary screen of a busy Claude Code agent still lands here.
   */
  readonly stateFallback?: boolean
  /**
   * When this delegation's screen last CHANGED, for a live row.
   *
   * Not when it was last observed — that is `updatedAt`. A state of `idle` that nothing confirmed says
   * only that no rule matched; how long the screen has been still is the evidence that separates
   * "finished" from "stuck", and it is the one signal Claude Code can give, since its manifest yields
   * no positive `working` state.
   */
  readonly lastChangeAt?: number
}

/** Every bounded result set reports what it withheld rather than truncating silently. */
export interface Bounded<T> {
  readonly items: readonly T[]
  /** How many matched but were not returned. `0` means the list is complete. */
  readonly withheld: number
  /** Total that matched the filter, before the bound. */
  readonly total: number
}

/**
 * The most rows one roster call may return.
 *
 * A wire bound, so it lives with the wire types: the request schema validates against it, the
 * backend clamps to it, and the UI needs it to ask for a page larger than its own default without
 * guessing where the server stops. It was previously spelled once in the schema and once in the
 * roster builder — two numbers that agreed by luck.
 */
export const MAX_ROSTER_LIMIT = 1_000

/**
 * The most events one `transcript` read may return.
 *
 * Also the ceiling on how far a single read sees. Every adapter reads from EITHER end, and
 * `transcript`'s `from` starts the window at an ordinal, so the middle is reachable too — measured as
 * 14,189 events in a real local history, 13.8% of all history, sitting inside the 10 sessions that exceed
 * this cap. What remains true is that no ONE read returns a long session whole.
 */
export const MAX_TRANSCRIPT_EVENTS = 2_000

/**
 * Did this session run on `model`?
 *
 * A session names its model in one of two places and never in both. Measured on a real local history: 22 of
 * 283 rows carry `SessionSummary.model` — GitHub Copilot writes `selectedModel` once at the head of
 * its log, Hermes keeps a `model` column, and neither reports token usage — while the other 261
 * carry no such field and attribute per-model usage instead. A filter that checked either alone
 * would answer for a twelfth of the corpus or for the rest of it.
 *
 * It lives here rather than in either fold because the roster and the statistics must not disagree
 * about what "used this model" means: to a reader, a bar of 17 that drills into a list of 4 is an
 * arithmetic error. Exact, not a prefix — `claude-opus-5` and `claude-opus-4-8` share a stem.
 */
export function sessionUsedModel(session: SessionSummary, model: string): boolean {
  if (session.model === model) return true
  return (session.usage?.byModel ?? []).some((entry) => entry.model === model)
}

/**
 * Is this session a child of `parentKey`?
 *
 * Composed rather than compared raw: a native id is unique only within its provider, so two agents
 * can hold the same parent id and a bare comparison would mix their trees. Measured on this
 * machine, parentage exists for three providers — claude-code (1,090 children), codex (158) and
 * opencode (35) — which is exactly the population where a collision is possible.
 */
export function sessionHasParent(session: SessionSummary, parentKey: string): boolean {
  if (!session.parentNativeSessionId) return false
  return (
    linkKeyOf({ provider: session.provider, nativeSessionId: session.parentNativeSessionId }) ===
    parentKey
  )
}

export interface RosterQuery {
  readonly text?: string
  readonly providers?: readonly ProviderId[]
  readonly states?: readonly AgentState[]
  readonly cwdPrefix?: string
  /** An exact model name, matched by `sessionUsedModel` against both places one is recorded. */
  readonly model?: string
  /**
   * A parent session's LINK KEY, selecting the sub-agents it spawned.
   *
   * The statistics' fan-out axis names a session and a number — "208 sub-agents" — and until this
   * existed the only way to act on it was a text search for the parent's key, which returns the
   * parent: a bar of 208 drilling into a list of 1. Children are hidden by default, so this filter
   * necessarily overrides that: asking for children while hiding children is a query with one
   * answer and it is the wrong one.
   */
  readonly parentKey?: string
  /**
   * Include sub-agent transcripts, which the roster hides by default.
   *
   * `StatsQuery` declared it and `RosterQuery` did not, so the service read it off the query through a
   * cast — a field the type denied and the code relied on. It is 84% of what a real local history holds: 282
   * top-level sessions against 1,822 with children, so 1,540 rows the workspace could not reach while
   * the tool could.
   */
  readonly includeChildren?: boolean
  readonly offset?: number
  readonly limit?: number
}

/** One normalized transcript event. */
export interface TranscriptEvent {
  readonly provider: ProviderId
  readonly nativeSessionId: string
  readonly role: 'user' | 'assistant' | 'tool' | 'system'
  /** Provider-reported wall-clock ms, when it reports one. See ORDERING note in context/compose. */
  readonly timestamp?: number
  /** Monotonic position WITHIN its own session. Always present; this is what we can trust. */
  readonly ordinal: number
  readonly text: string
  readonly toolName?: string
  /**
   * The provider's own id for this tool call, on the call AND on its result.
   *
   * Present only where the source records one. It is what lets a result be attached to the call it
   * belongs to instead of to the call above it — the two differ the moment an agent issues several
   * calls before any returns, which is routine with parallel tool use.
   */
  readonly toolCallId?: string
  /** Tool arguments as the provider recorded them. Never parsed out of prose. */
  readonly toolInput?: unknown
  readonly touchedFiles?: readonly string[]
}

export interface TranscriptSlice {
  readonly key: string
  readonly summary: SessionSummary
  readonly events: readonly TranscriptEvent[]
  /** Events that existed but were not returned, because of the budget. Never silently dropped. */
  readonly withheld: number
  readonly total: number
  /**
   * The SOURCE was cut short by the adapter's byte cap, so `total` counts only what fitted.
   *
   * Distinct from `withheld`, which is a number we know. This says the number itself is a floor: the
   * file held more and we never read it. Load-bearing for any claim about which END a window sits
   * at — a tail read of a capped file returns the middle of the session, and in a real local history's
   * largest transcript (47.72 MB, 21,220 lines) that middle ended 7h40m before the session did.
   */
  readonly sourceTruncated?: boolean
  /**
   * Which END this slice was read from. Only meaningful together with `sourceTruncated`: when the
   * whole session fits, both ends are present and the question does not arise.
   *
   * It exists because suppressing every end-claim on a truncated read was right when a "tail" was
   * really the front of the file, and became an UNDER-claim the moment tail reads started reading
   * backwards. A truncated tail read genuinely ends where the session ends; a truncated head read
   * genuinely begins where it begins. Saying neither is as wrong as saying the wrong one.
   */
  readonly readFrom?: 'head' | 'tail'
}

/**
 * The provider's OWN quota window, as it reported it. Account state, never session state — two
 * sessions of the same agent share one window, so the newest reading is the current one and an older
 * session's figure says nothing about now.
 *
 * Only Codex records this. Measured on a real local history: 207 of 208 rollouts carry `rate_limits` on the
 * `token_count` event the summary walk already visits, so reading it costs no extra I/O. Forty
 * Claude Code transcripts carry no counterpart in any usage record, which is why this is optional
 * rather than a field every provider owes.
 *
 * An account can have SEVERAL windows at once, and `primary` does not name a fixed one. In 206 of
 * a real history's 207 readings `primary` is the weekly window and `secondary` is absent; in the one
 * that carries both, `primary` is a 5-HOUR window at 45% and the weekly sits in `secondary` at 7%.
 * So a reading is identified by its LENGTH, never by the slot it arrived in — comparing a 5-hour
 * percentage against a weekly one under a single label is comparing different quantities.
 */
export interface QuotaReading {
  /** How much of the window the account has spent, as the provider computed it. */
  readonly usedPercent: number
  /** The window's length, and its IDENTITY: 300 is a 5-hour window, 10080 a weekly one. */
  readonly windowMinutes: number
  /** When the window resets, in unix ms. Past means this reading has expired — see `quotaIsCurrent`. */
  readonly resetsAt: number
  readonly planType?: string
  /** When the provider wrote the reading. */
  readonly observedAt: number
}

/**
 * A reading describes a window that ENDS. Past its reset the percentage is not merely old, it is
 * about a window that no longer exists — showing it would be a confident number for the wrong period.
 */
export function quotaIsCurrent(quota: QuotaReading, now: number): boolean {
  return quota.resetsAt > now
}

/**
 * Where a percentage stops being background and starts being a decision. Below this the figure is
 * trivia; above it, it is the answer to "can I start another agent right now", which is the question
 * an orchestrator actually has.
 */
export const QUOTA_WARN_PERCENT = 80

/**
 * How long a live delegation's screen must be unchanged before saying so is informative.
 *
 * Below this the mark appears on every healthy delegation — a screen redraws between turns — and a
 * mark a reader always sees is a mark they stop reading. Shared so the workspace and the tool cannot
 * decide it separately; the number is Symphony's own `stall_timeout_ms` default (SPEC.md:633).
 */
export const QUIET_SCREEN_MS = 5 * 60_000

/** Minutes a live screen has been still, or `undefined` when that is not worth saying. */
export function quietMinutes(lastChangeAt: number | undefined, now: number): number | undefined {
  if (lastChangeAt === undefined) return undefined
  const quiet = now - lastChangeAt
  return quiet >= QUIET_SCREEN_MS ? Math.round(quiet / 60_000) : undefined
}

/**
 * The window a caller is actually up against: the fullest one still running.
 *
 * With two windows open, the weekly can read 7% while the 5-hour one reads 45% — and the 5-hour one
 * is what stops the next agent from starting. Showing "the quota" without choosing means showing
 * whichever the provider happened to list first.
 */
export function bindingQuota(
  quotas: readonly QuotaReading[],
  now: number,
): QuotaReading | undefined {
  let binding: QuotaReading | undefined
  for (const quota of quotas) {
    if (!quotaIsCurrent(quota, now)) continue
    if (!binding || quota.usedPercent > binding.usedPercent) binding = quota
  }
  return binding
}

/** One wording for every surface, so the workspace chip and the tool never disagree by a rounding. */
export function formatQuota(quota: QuotaReading, now: number): string {
  if (!quotaIsCurrent(quota, now)) {
    return `quota window ended ${shortSpan(now - quota.resetsAt)} ago — no current reading`
  }
  const window = shortSpan(quota.windowMinutes * 60_000)
  return `${Math.round(quota.usedPercent)}% of a ${window} window · resets in ${shortSpan(quota.resetsAt - now)}`
}

/** Two units at most: a quota is read at a glance or not at all. */
function shortSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${minutes}m`
}

export interface ProviderStatus {
  readonly provider: ProviderId
  readonly displayName: string
  /** Roots we actually probed, with whether each exists on this machine. */
  readonly roots: readonly { readonly path: string; readonly exists: boolean }[]
  /**
   * TOP-LEVEL sessions — the same population the roster and the statistics count.
   *
   * It deliberately excludes sub-agent transcripts. In a real local history Claude Code has 123 top-level
   * sessions and 1581 sub-agent files beneath them, so counting every file made the providers strip
   * say "1706" beside a list showing 123: two different quantities wearing one name.
   */
  readonly sessionCount: number
  /** Sub-agent transcripts nested under those sessions, when the provider nests any. */
  readonly childSessionCount?: number
  /** Populated when a scan failed — surfaced in the UI rather than swallowed. */
  readonly error?: string
  readonly lastScanMs?: number
  /** Whether this provider was verified against real on-disk data by its author. */
  readonly verified: boolean
  /**
   * The newest reading of EACH window this provider left on disk, when it records any. Several
   * because an account can be inside more than one window at once.
   */
  readonly quotas?: readonly QuotaReading[]
}

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

export type { AgentState, StateAuthority, StateExplain, ProviderId }
