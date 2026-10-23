import { TOOL_GC_PROTECTED } from './tool-policy-sets'

/**
 * Suggest-only garbage collection over the model-facing tool surface.
 *
 * Pure, descriptor-free, no DB — the same shape as `resolveToolPolicyDenials` next door: facts in,
 * reasons out. Nothing here writes, and nothing downstream of it writes on its own either.
 *
 * That constraint is the design. The ambitious version — a router that indexes tools per source and
 * spends a SECOND model call to pick which ones the run may see — buys its selectivity with latency
 * on every turn, with selection quality that is itself unmeasured, and with a surface that changes
 * under the user without their asking. A rule set with no model call and no automatic mutation of the
 * surface does not have to answer any of them.
 */

/** A tool currently on the wire, with the attribution needed to route an "off" action. */
export interface ToolGcSurfaced {
  name: string
  source: 'builtin' | 'mini-app' | 'mcp'
  /** Mini app name or MCP server id; `''` for a builtin. */
  originId: string
}

/** One tool's observed history in the scope being judged. */
export interface ToolGcUsage {
  name: string
  calls: number
  errors: number
  /** When the tool first became AVAILABLE, not when the row was written. */
  firstSeenAt: string
  lastUsedAt: string | null
}

export interface ToolGcInput {
  surfaced: readonly ToolGcSurfaced[]
  usage: readonly ToolGcUsage[]
  /** ISO timestamp to judge against. Passed in so the rules stay pure and testable. */
  now: string
}

export type ToolGcReason = 'never-used' | 'cold' | 'always-errors'

export interface ToolGcSuggestion {
  name: string
  reason: ToolGcReason
  /** Prose for the UI. Owned here so the sentence and the rule that produced it cannot drift. */
  detail: string
  calls: number
  lastUsedAt: string | null
  /** Where the "off" switch for this tool actually lives. */
  target: { kind: 'settings' } | { kind: 'mcp'; serverId: string }
}

export interface ToolGcEvidence {
  totalCalls: number
  /** Earliest observation in the scope, or null when nothing has been observed at all. */
  observedSince: string | null
  /** False ⇒ the report is empty on purpose, not because everything is in use. */
  sufficient: boolean
}

export interface ToolGcReport {
  evidence: ToolGcEvidence
  suggestions: ToolGcSuggestion[]
}

/**
 * How much history has to exist before any suggestion is allowed out.
 *
 * Both halves are load-bearing and neither implies the other: 200 calls in an afternoon says
 * nothing about a tool you reach for weekly, and two weeks of five calls says nothing about
 * anything. A fresh install therefore produces an EMPTY report rather than a purge — the failure
 * mode that makes a feature like this untrustworthy on first contact.
 *
 * The denominator comes from the usage table itself. No separate counter is stored, so the gate
 * cannot disagree with the rows it is gating.
 */
export const TOOL_GC_MIN_TOTAL_CALLS = 200
export const TOOL_GC_MIN_OBSERVATION_DAYS = 7

/** A tool must have been AVAILABLE this long before "never used" means anything. */
export const TOOL_GC_NEVER_USED_DAYS = 7
/** Silence this long is treated as cold. */
export const TOOL_GC_COLD_DAYS = 30
/** Below this many failures, an all-error record is noise rather than evidence. */
export const TOOL_GC_MIN_ERRORS = 5

/**
 * Budget defaults. 37 builtins ship enabled, so a threshold of 20 would be amber on a clean
 * install — alarm fatigue before the first real signal. 48 sits above the stock surface, which is
 * the property that matters: the warning fires on what a user added, not on what shipped.
 */
export const TOOL_BUDGET_WARN_DEFAULT = 48
export const TOOL_BUDGET_HOT_MARGIN = 16
/**
 * Amber does not clear at the same count that raised it. Without the gap, a surface parked on the
 * threshold flips the pill on every plugin toggle — motion that carries no information and trains
 * the user to ignore it.
 */
export const TOOL_BUDGET_HYSTERESIS = 4

const DAY_MS = 86_400_000

/** Parse an ISO timestamp, or null when it is absent/garbage. Never throws on stored data. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function daysBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / DAY_MS
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Classify one tool. Returns the FIRST reason that applies, so a tool never produces two rows —
 * the user is being offered one action (turn it off), and two justifications for it would read as
 * two separate problems.
 */
function classify(
  usage: ToolGcUsage,
  nowMs: number,
): { reason: ToolGcReason; detail: string } | null {
  const firstSeenMs = parseTime(usage.firstSeenAt)
  const lastUsedMs = parseTime(usage.lastUsedAt)

  if (usage.calls === 0) {
    // An unparseable `first_seen_at` fails CLOSED: unknown age cannot clear an age gate.
    if (firstSeenMs === null) return null
    const age = daysBetween(firstSeenMs, nowMs)
    if (age < TOOL_GC_NEVER_USED_DAYS) return null
    return {
      reason: 'never-used',
      detail: `Available for ${plural(Math.floor(age), 'day')} and never called.`,
    }
  }

  if (lastUsedMs !== null) {
    const idle = daysBetween(lastUsedMs, nowMs)
    if (idle >= TOOL_GC_COLD_DAYS) {
      return {
        reason: 'cold',
        detail: `Last used ${plural(Math.floor(idle), 'day')} ago, ${plural(usage.calls, 'call')} in total.`,
      }
    }
  }

  // Checked after "cold" so a tool that is both reports the weaker, non-accusatory reason — the
  // action is identical either way, and "you stopped using it" is the safer claim to make about a
  // tool nobody has exercised recently enough to know is still broken.
  if (usage.errors >= TOOL_GC_MIN_ERRORS && usage.calls === usage.errors) {
    return {
      reason: 'always-errors',
      detail: `Every one of its ${plural(usage.calls, 'call')} failed.`,
    }
  }

  return null
}

const REASON_ORDER: Record<ToolGcReason, number> = {
  'never-used': 0,
  cold: 1,
  'always-errors': 2,
}

export function resolveToolGc(input: ToolGcInput): ToolGcReport {
  const nowMs = parseTime(input.now) ?? Date.now()

  // The denominator spans EVERY row, including tools no longer surfaced. The question it answers
  // is "has this scope been used enough to judge anything", and a tool disabled last week still
  // contributes the evidence that the user was working here.
  let totalCalls = 0
  let observedSinceMs: number | null = null
  for (const row of input.usage) {
    totalCalls += Math.max(0, row.calls)
    const firstSeenMs = parseTime(row.firstSeenAt)
    if (firstSeenMs !== null && (observedSinceMs === null || firstSeenMs < observedSinceMs)) {
      observedSinceMs = firstSeenMs
    }
  }

  const observationDays = observedSinceMs === null ? 0 : daysBetween(observedSinceMs, nowMs)
  const sufficient =
    totalCalls >= TOOL_GC_MIN_TOTAL_CALLS && observationDays >= TOOL_GC_MIN_OBSERVATION_DAYS

  const evidence: ToolGcEvidence = {
    totalCalls,
    observedSince: observedSinceMs === null ? null : new Date(observedSinceMs).toISOString(),
    sufficient,
  }
  if (!sufficient) return { evidence, suggestions: [] }

  const protectedNames = new Set(TOOL_GC_PROTECTED)
  const usageByName = new Map(input.usage.map((row) => [row.name, row]))
  const suggestions: ToolGcSuggestion[] = []

  // Only SURFACED tools are candidates: a tool that is already off cannot be turned off, and
  // offering it would be the report claiming credit for work the user already did.
  for (const tool of input.surfaced) {
    if (protectedNames.has(tool.name)) continue
    const usage = usageByName.get(tool.name)
    // No row at all means the roster write has not run for it yet. Absent evidence is not
    // evidence of absence — say nothing rather than guess.
    if (!usage) continue
    const verdict = classify(usage, nowMs)
    if (!verdict) continue
    suggestions.push({
      name: tool.name,
      reason: verdict.reason,
      detail: verdict.detail,
      calls: usage.calls,
      lastUsedAt: usage.lastUsedAt,
      target:
        tool.source === 'mcp' && tool.originId
          ? { kind: 'mcp', serverId: tool.originId }
          : { kind: 'settings' },
    })
  }

  // Strongest evidence first, then least-used first. `name` breaks the final tie so the list is
  // stable across calls — a report that reshuffles between refreshes cannot be checkbox-reviewed.
  suggestions.sort(
    (a, b) =>
      REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
      a.calls - b.calls ||
      (parseTime(a.lastUsedAt) ?? 0) - (parseTime(b.lastUsedAt) ?? 0) ||
      a.name.localeCompare(b.name),
  )

  return { evidence, suggestions }
}
