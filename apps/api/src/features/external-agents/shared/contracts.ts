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
import type { QuotaReading } from './quotas'

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

export * from './quotas'
export * from './statistics'
export type { ProviderStatus } from './provider-status'
export type { AgentState, StateAuthority, StateExplain, ProviderId }
