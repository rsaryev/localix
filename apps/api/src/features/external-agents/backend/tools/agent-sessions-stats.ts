import type { AgentSessionsInput } from './agent-sessions-schema'
import type { ExternalAgentStats, StatBucket } from '../../shared/contracts'
import { DEFAULT_STATS_DAYS } from '../../shared/contracts'

/**
 * Rows per axis in the model-facing summary. The UI can page a long list; a model paying per token
 * cannot, and eight is enough to see where the work went or to learn the axis needs narrowing.
 */
const TOOL_AXIS_ROWS = 8

/** Compact enough for a bullet, and never a bare zero where nothing was measured. */
function tokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function sessionsAndTokens(bucket: StatBucket): string {
  const total = bucket.usage?.totalTokens
  return total
    ? `${bucket.sessions} session(s) · ${tokens(total)} tokens`
    : `${bucket.sessions} session(s)`
}

/**
 * What the UI leads with, which this answer omitted entirely: the providers record per-request token
 * usage and we read it, but `stats` reported session COUNTS alone. A model asking where the work went
 * got the shape and none of the weight.
 *
 * "Processed" is deliberate — the figure includes cache re-reads, and core's identically-named total
 * does not. See the note in ui/ui/StatsView.tsx.
 */
function tokenHeadline(stats: ExternalAgentStats): string[] {
  const usage = stats.usage
  if (!usage || usage.totalTokens === 0) return []
  const fresh = usage.inputTokens + usage.outputTokens
  return [
    `${tokens(usage.totalTokens)} tokens processed (cache re-reads included; ${tokens(fresh)} fresh input+output)` +
      ` across ${usage.requests.toLocaleString()} request(s), measured for ${stats.usageSessions} of ${stats.sessions} session(s).`,
  ]
}

function projectHeading(stats: ExternalAgentStats): string {
  const shown = Math.min(TOOL_AXIS_ROWS, stats.byProject.length)
  return stats.projects > shown ? `By project (top ${shown} of ${stats.projects}):` : 'By project:'
}

/**
 * What each session FANNED OUT to, with the key that selects those children.
 *
 * The workspace grew this axis and the tool did not, which made the `parentKey` filter's own
 * description a false promise: it tells a caller to read keys off `stats`, and `stats` printed
 * none. An orchestrator's most direct question — what did this run spawn, and can I list it — was
 * answerable only from a screen it cannot see.
 */
function delegationLines(stats: ExternalAgentStats): string[] {
  if (stats.byParent.length === 0) return []
  return [
    '',
    'Most delegating sessions (pass a key as "parent_key" to list its sub-agents):',
    ...stats.byParent.map((b) => `- ${b.key}: ${b.sessions} sub-agent(s) · ${b.label ?? ''}`),
  ]
}

/**
 * The heaviest individual runs. Every other axis aggregates, so this is the only one that answers
 * "which sessions cost the most" — and the answer is concentrated: 10 of 212 sessions hold 53% of
 * every token measured here. The key is printed because it is what the next call takes.
 */
function heaviestLines(stats: ExternalAgentStats): string[] {
  if (stats.topSessions.length === 0) return []
  return [
    '',
    'Heaviest sessions:',
    ...stats.topSessions.map(
      (b) => `- ${b.key}: ${tokens(b.usage?.totalTokens ?? 0)} tokens · ${b.label ?? ''}`,
    ),
  ]
}

/** The axis the UI shows and this answer did not have at all. */
function modelLines(stats: ExternalAgentStats): string[] {
  if (stats.byModel.length === 0) return []
  const shown = stats.byModel.slice(0, TOOL_AXIS_ROWS)
  const heading =
    stats.byModel.length > shown.length
      ? `By model (top ${shown.length} of ${stats.byModel.length}):`
      : 'By model:'
  return ['', heading, ...shown.map((b) => `- ${b.key}: ${sessionsAndTokens(b)}`)]
}

/**
 * Agents the window excluded entirely.
 *
 * The same blindness the workspace had: `By agent` listed two of a real history's six providers, and a
 * model reading it concludes the other four have no history. They hold 105 sessions. The suggested
 * `days` is the smallest range that would reach the newest of them, so the next call is one number
 * away rather than a guess.
 */
function outsideRangeLines(stats: ExternalAgentStats, now: number): string[] {
  // `?? []` because a service result crosses a boundary the type cannot police — a stub, or a
  // backend half that predates the field, yields `undefined` and would throw here.
  const outside = stats.outsideRange ?? []
  if (outside.length === 0) return []
  const newest = Math.max(...outside.map((bucket) => bucket.updatedAt))
  const reach = Math.max(1, Math.ceil((now - newest) / 86_400_000))
  const held = outside.reduce((sum, bucket) => sum + bucket.sessions, 0)
  return [
    '',
    `Outside this range: ${outside
      .map((bucket) => `${bucket.key} (${bucket.sessions})`)
      .join(
        ', ',
      )} — ${held} session(s) with nothing in the window. Widen with days: ${reach} to reach the newest.`,
  ]
}

function iso(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** Render the model-facing statistics after the service has applied the request filters. */
export function renderAgentSessionStats(
  stats: ExternalAgentStats,
  input: Pick<AgentSessionsInput, 'days' | 'providers'>,
): { content: string } {
  if (stats.sessions === 0) {
    // Every figure is window-scoped, so "nothing" usually means "nothing lately" — say which,
    // or the model concludes the machine is empty and stops asking.
    return {
      content:
        stats.firstAt === undefined
          ? 'No external agent history matched. Try { action: "providers" }.'
          : `No sessions in the last ${input.days ?? DEFAULT_STATS_DAYS} day(s), though history here starts ${iso(stats.firstAt)}. Retry with a larger "days".`,
    }
  }
  // A summary is the point: it answers "where has external work happened" without paging a
  // roster that is hundreds of rows long on a real machine.
  const span =
    stats.firstAt !== undefined && stats.lastAt !== undefined
      ? `${iso(stats.firstAt)} → ${iso(stats.lastAt)}`
      : 'unknown span'
  const lines = [
    `${stats.sessions} session(s) over ${stats.activeDays} active day(s) of the last ${input.days ?? DEFAULT_STATS_DAYS}, in ${stats.projects} project(s)${
      stats.medianDurationMs
        ? ` · median session ${Math.round(stats.medianDurationMs / 60_000)} min`
        : ''
    }`,
    ...tokenHeadline(stats),
    `All history spans ${span}.`,
    '',
    // Listed for EVERY agent even under a `providers` filter, because it is the axis a filter is
    // chosen from. Saying so stops a filtered call reading as a filter that failed to apply.
    input.providers?.length ? 'By agent (every agent, not just the filtered one):' : 'By agent:',
    ...stats.byProvider.map((b) => `- ${b.key}: ${sessionsAndTokens(b)}`),
    '',
    // The slice is a bound and says so, like every other bound here.
    projectHeading(stats),
    ...stats.byProject.slice(0, TOOL_AXIS_ROWS).map((b) => `- ${b.key}: ${sessionsAndTokens(b)}`),
    ...modelLines(stats),
    ...delegationLines(stats),
    ...heaviestLines(stats),
    ...outsideRangeLines(stats, Date.now()),
  ]
  return { content: lines.join('\n') }
}
