import { useMemo } from 'react'
import { StatCard, StatSection } from '@localixai/kit/stat'
import { DistributionChart, TrendChart } from '@localixai/plugin-sdk/ui/stats-charts'
import { Segmented } from '@localixai/plugin-sdk/ui/segmented-control'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { useExternalAgentsProblem } from '../problems'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { middleEllipsis } from '../model/pathLabel'
import { formatTokens } from '@localixai/plugin-sdk/ui/utilities'
import { formatQuota, QUOTA_WARN_PERCENT, quotaIsCurrent } from '../model/types'
import type { ExternalAgentStats, ProviderStatus } from '../model/types'

/**
 * A capped axis names its POPULATION, not a shown count.
 *
 * `DistributionChart` draws at most eight rows and discloses the rest itself, so a title claiming
 * "top 12" beside eight bars was one number too many. The backend fold and the chart are two
 * different bounds; each states its own.
 *
 * `byProject` keeps the top `STATS_PROJECT_LIMIT` and folds the tail; `projects` counts every
 * distinct directory. So the tile could read 20 beside a chart of 12 bars with nothing explaining the
 * gap — measured on a real local history, exactly that: 12 listed of 20. Every other bound in this plugin
 * states itself (the roster's "Showing 50 of 104", the digest's turn range), and this one did not.
 */
/** Named with its bound, like every other capped axis here. */
function heaviestAxisTitle(stats: ExternalAgentStats): string {
  const ranked = stats.topSessions.length
  return ranked > 0 && ranked < stats.usageSessions
    ? `Heaviest sessions of ${stats.usageSessions} measured`
    : 'Heaviest sessions'
}

/**
 * The bucket the fold uses for sessions with no cwd. It is a LABEL, not a path, so it cannot become a
 * `cwdPrefix` — selecting it would filter for sessions whose directory starts with that sentence, which
 * is every session and none.
 */
const NO_CWD_BUCKET = 'no working directory recorded'

function projectAxisTitle(stats: ExternalAgentStats): string {
  return stats.projects > stats.byProject.length
    ? `By project, of ${stats.projects} distinct`
    : 'By project'
}

/**
 * Statistics over the history discovered on this machine.
 *
 * Drawn by the SAME charts our own usage stats use — they were generalized from spend to "a label
 * and a number" for exactly this, so the two screens cannot drift into looking like two products.
 *
 * Usage is the provider's own measured record. Cost is intentionally not inferred from today's API
 * price: these are frequently subscription sessions, so that number would be an estimate rather
 * than billing.
 *
 * ── The headline is NOT our own screen's "Total tokens" ────────────────────────────────────────
 *
 * It counts every token that passed through, cache re-reads included, which is the convention the
 * providers' own tooling uses (CodexBar reports `tokens` beside `cached_input_tokens` the same way).
 * Core's usage repository stores cache reads in their own columns and totals
 * `inputTokens + outputTokens`, so the identically-named figure there means the fresh half alone.
 *
 * Measured across a real local history, the two differ by 12x to 506x — and by a DIFFERENT factor
 * per provider (claude-code 506x at 99.8% cache, codex 35x, opencode and gemini-cli 12x), so a
 * reader cannot correct for it mentally. Sharing the charts is what makes the two screens one
 * product; sharing a label for two quantities is what would make them lie. Hence the name below
 * says which measure it is, and the tooltip names the comparable one.
 */
/**
 * The account's own limit — the one thing on this screen that is not about the range.
 *
 * ABOVE the range bar deliberately: that bar promises "every figure BELOW covers the last 30 days",
 * and a quota is the state of a window the provider owns, running on its own clock. Placed under
 * that sentence it would make the sentence false.
 *
 * Only providers that record one appear. Codex writes `rate_limits` on the same event as its token
 * counters; Claude Code, opencode and Gemini CLI write no counterpart, and inventing a 0% for them
 * would be a confident claim about an account nobody measured.
 *
 * One row per WINDOW, because an account can be inside several: the weekly can read 7% while the
 * 5-hour one reads 45%, and only the second decides whether the next agent starts.
 *
 * Expired windows are dropped rather than listed as "ended". What expired is our READING, not the
 * account's window — this machine holds a 5-hour reading from three weeks ago, and a row saying it
 * ended 23 days ago states something about the account that is not true.
 */
/**
 * Agents whose history lies OUTSIDE the selected range.
 *
 * The default range is 30 days, and in a real local history four of six providers have nothing in it —
 * opencode 0 of 23 sessions, Gemini CLI 0 of 29, Copilot 0 of 34, Hermes 0 of 19: 105 sessions that
 * exist, are listed in the roster, and leave no bar on the agent chart. "Every figure covers the last
 * 30 days" is true and does not say that, and the chart cannot say it either — an agent with nothing
 * in range has nothing to draw.
 *
 * The SET comes from the fold (`ExternalAgentStats.outsideRange`), not from provider statuses derived
 * here. Both this screen and the `stats` tool need it, and only the fold can compute it: it is the one
 * place that still holds the rows the window excluded. Deriving it twice is how two surfaces come to
 * disagree. Display names are resolved from the map this screen already has.
 */
function OutsideRange({
  stats,
  providerNames,
  days,
}: {
  stats: ExternalAgentStats
  providerNames: ReadonlyMap<string, string>
  days: StatsDays
}) {
  // `?? []` because this is WIRE data, as the trend memo above already assumes: the plugin's backend
  // hot-reloads independently of this bundle, so a field the type requires can still be absent from a
  // response written by an older half. A missing figure must draw nothing, not blank the panel.
  const outside = stats.outsideRange ?? []
  if (outside.length === 0) return null
  const names = outside.map((row) => providerNames.get(row.key) ?? row.key)
  const held = outside.reduce((sum, row) => sum + row.sessions, 0)
  return (
    <span className="text-2xs text-text-faint">
      {names.length === 1 ? `${names[0]} has` : `${names.join(', ')} have`} {held} session(s)
      outside {RANGE_SCOPE[days]}.
    </span>
  )
}

function QuotaBar({
  providers,
  selectedProvider,
}: {
  providers: readonly ProviderStatus[]
  selectedProvider?: string
}) {
  const now = Date.now()
  const rows = providers.flatMap((provider) =>
    !selectedProvider || provider.provider === selectedProvider
      ? (provider.quotas ?? [])
          .filter((quota) => quotaIsCurrent(quota, now))
          .map((quota) => ({ provider, quota }))
      : [],
  )
  if (rows.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
      {rows.map(({ provider, quota }) => (
        <span key={`${provider.provider}:${quota.windowMinutes}`} className="text-text-faint">
          <span className="text-text-soft">{provider.displayName}</span>{' '}
          <span
            className={
              quotaIsCurrent(quota, now) && quota.usedPercent >= QUOTA_WARN_PERCENT
                ? 'tabular-nums text-status-warning'
                : 'tabular-nums'
            }
          >
            {formatQuota(quota, now)}
          </span>
        </span>
      ))}
    </div>
  )
}

export function StatsView({
  stats,
  loading,
  error,
  errorDetail,
  onRetry,
  providerNames,
  providers,
  onSelectProvider,
  selectedProvider,
  onSelectProject,
  selectedProject,
  onSelectSession,
  onSelectParent,
  onSelectModel,
  selectedModel,
  days,
  onChangeDays,
}: {
  stats: ExternalAgentStats | null
  loading: boolean
  error: string | null
  /** The raw text behind `error`. Event Center only, never on the line. */
  errorDetail?: string | null
  onRetry: () => void
  providerNames: ReadonlyMap<string, string>
  /** Provider STATUS, not the name map: the quota bar reads the account window off it. */
  providers: readonly ProviderStatus[]
  onSelectProvider?: (provider: string) => void
  selectedProvider?: string
  /**
   * Drill by project. `RosterQuery.cwdPrefix` and the route that validates it have existed since the
   * roster did, and nothing ever sent one — the filter was implemented, bounded and unreachable.
   */
  onSelectProject?: (cwd: string) => void
  selectedProject?: string
  /**
   * Drill into one session. It FILTERS the roster by that key rather than opening the session, which
   * is what every other axis here does — and it sidesteps the reason this chart was left inert: a
   * bucket carries a key and a title but no cwd, so opening from it would hand the import action a
   * session with no project. Filtering hands the reader a complete row to open instead.
   */
  onSelectSession?: (key: string) => void
  /**
   * Drill by model — the one axis here that only ever read back a number. The predicate behind it is
   * shared (`sessionUsedModel`), because a session records its model in one of two places.
   */
  /**
   * Drill into the sub-agents a session spawned. Separate from `onSelectSession` because the bar
   * names a PARENT and the number on it is its children: filtering by the parent's own key returns
   * the parent — a bar of 208 landing in a list of 1.
   */
  onSelectParent?: (key: string) => void
  onSelectModel?: (model: string) => void
  selectedModel?: string
  days: StatsDays
  onChangeDays: (days: StatsDays) => void
}) {
  const hasUsage = (stats?.usageSessions ?? 0) > 0 && stats?.usage !== undefined
  const trend = useMemo(() => {
    return (stats?.byDay ?? []).map((day) => ({
      key: day.key,
      value: hasUsage ? (day.usage?.totalTokens ?? 0) : day.sessions,
    }))
  }, [hasUsage, stats])
  const byProvider = useMemo(
    () =>
      (stats?.byProvider ?? []).map((row) => ({
        key: row.key,
        value: hasUsage ? (row.usage?.totalTokens ?? 0) : row.sessions,
      })),
    [hasUsage, stats],
  )
  const byProject = useMemo(
    () =>
      (stats?.byProject ?? []).map((row) => ({
        key: row.key,
        value: hasUsage ? (row.usage?.totalTokens ?? 0) : row.sessions,
      })),
    [hasUsage, stats],
  )
  const heaviest = useMemo(
    () =>
      (stats?.topSessions ?? []).map((row) => ({
        key: row.key,
        value: row.usage?.totalTokens ?? 0,
      })),
    [stats],
  )
  /**
   * Session key → the title a reader recognises.
   *
   * `DistributionChart` renders `labelKey(row.key)` as the visible text and puts the raw key in the
   * bar's hover title; it has no `detail` slot — that belongs to `TrendChart`. Passing `detail` here
   * left every bar labelled `claude-code:cc71d515-fee9-…`, and the test meant to cover it asserted
   * the KEY, so it passed while the titles were invisible.
   */
  const heaviestLabels = useMemo(
    () => new Map((stats?.topSessions ?? []).map((row) => [row.key, row.label ?? row.key])),
    [stats],
  )
  /**
   * How far each session FANNED OUT, which is the one question the rest of this screen cannot
   * answer: every other axis measures what a session cost.
   */
  const delegating = useMemo(
    () => (stats?.byParent ?? []).map((row) => ({ key: row.key, value: row.sessions })),
    [stats],
  )
  const delegatedTotal = useMemo(
    () => (stats?.byParent ?? []).reduce((sum, row) => sum + row.sessions, 0),
    [stats],
  )
  const delegatingLabels = useMemo(
    () => new Map((stats?.byParent ?? []).map((row) => [row.key, row.label ?? row.key])),
    [stats],
  )
  const byModel = useMemo(
    () =>
      (stats?.byModel ?? []).map((row) => ({
        key: row.key,
        value: row.usage?.totalTokens ?? 0,
      })),
    [stats],
  )

  const problem = useExternalAgentsProblem({
    subject: 'Statistics',
    message: error,
    detail: errorDetail,
    onRetry,
    centered: true,
  })
  if (problem) return problem
  // Pane-level hints take the space the dashboard would have had, so they center in it.
  if (loading && !stats)
    return <LoadingHint className="h-auto min-h-0 flex-1">Folding the history…</LoadingHint>
  // An empty WINDOW is not an empty machine, and the two need different sentences: the first is
  // fixed by widening the range, the second cannot be fixed at all.
  if (!stats || (stats.sessions === 0 && stats.firstAt === undefined)) {
    return (
      <EmptyHint className="h-auto min-h-0 flex-1">
        No external agent history on this machine yet.
      </EmptyHint>
    )
  }

  // The range scopes every figure on this screen, so it is a screen-level control. It used to sit
  // in the trend section's header, which read as "this chart only" — and that is precisely what it
  // did, while the distributions beside it quietly answered for all time.
  // The quota chips and the scope sentence are ONE piece of chrome, so they sit in one stacked
  // toolbar: a single `px-3` measure and a single bottom seam, instead of two hand-rolled rows on
  // their own `px-4` and a divider between them.
  const range = (
    <WorkbenchToolbar layout="stacked" aria-label="Statistics scope">
      <QuotaBar providers={providers} selectedProvider={selectedProvider} />
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-2xs text-text-faint">
          <span>Every figure below covers {RANGE_SCOPE[days]}.</span>
          {stats !== null && (
            <OutsideRange stats={stats} providerNames={providerNames} days={days} />
          )}
        </span>
        <span className="shrink-0">
          <Segmented
            aria-label="Statistics range"
            options={STATS_RANGES}
            value={days}
            onChange={(next) => onChangeDays(next)}
          />
        </span>
      </div>
    </WorkbenchToolbar>
  )

  // A quiet window still keeps the control that widens it — an EmptyHint on its own would strand
  // the reader on the range that emptied the screen.
  if (stats.sessions === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {range}
        <EmptyHint className="h-auto min-h-0 flex-1">
          {`No sessions in ${RANGE_SCOPE[days]} — history here starts ${new Date(
            stats.firstAt as number,
          ).toLocaleDateString()}.`}
        </EmptyHint>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {range}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <StatCard
              label="Tokens processed"
              value={stats.usage ? formatTokens(stats.usage.totalTokens) : '—'}
              title={
                stats.usage
                  ? `Every token the providers reported, cache re-reads included. ${formatTokens(
                      stats.usage.inputTokens + stats.usage.outputTokens,
                    )} of it is fresh input plus output — that is the figure our own usage screen calls "Total tokens".`
                  : 'Provider-reported model consumption in this range'
              }
            />
            <StatCard
              label="Input"
              value={stats.usage ? formatTokens(stats.usage.inputTokens) : '—'}
              title="Non-cached prompt tokens"
            />
            <StatCard
              label="Output"
              value={stats.usage ? formatTokens(stats.usage.outputTokens) : '—'}
              title={
                stats.usage
                  ? `${formatTokens(stats.usage.reasoningTokens)} reasoning tokens included`
                  : 'Provider-reported output tokens'
              }
            />
            <StatCard
              label="Cache reuse"
              value={stats.usage ? formatCacheRate(stats.usage) : '—'}
              title={
                stats.usage
                  ? `${formatTokens(stats.usage.cachedInputTokens)} cached input tokens`
                  : 'No provider-reported cache usage in this range'
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <StatCard
              label="Requests"
              value={stats.usage ? formatTokens(stats.usage.requests) : '—'}
            />
            <StatCard label="Sessions" value={stats.sessions} />
            <StatCard
              label="Sub-agents"
              // Counted from the fan-out axis, so the tile and the bars below cannot disagree. A
              // dash rather than 0: three of the six providers record no parentage at all, and "0"
              // would say those agents delegated nothing instead of saying nothing was recorded.
              value={delegatedTotal > 0 ? delegatedTotal : '—'}
              title={
                delegatedTotal > 0
                  ? 'Sub-agent transcripts spawned by the sessions ranked below'
                  : 'No session in this range recorded spawning one'
              }
            />
            <StatCard
              label="Models"
              // A dash, not 0, when nothing recorded one: every other tile in this row already says
              // "not measured" that way, and `0 models` is a claim about the agents rather than about
              // what their logs carry. GitHub Copilot records `selectedModel` on 3 of its 34 sessions
              // here, so the axis is short and honest rather than absent and wrong.
              value={stats.byModel.length > 0 ? stats.byModel.length : '—'}
              title={
                stats.byModel.length > 0
                  ? undefined
                  : 'No session in this range recorded which model it ran on'
              }
            />
            <StatCard
              label="Median session"
              value={stats.medianDurationMs ? formatDuration(stats.medianDurationMs) : '—'}
              title="Median wall-clock span of sessions that record both a start and an end"
            />
          </div>

          <StatSection
            title={hasUsage ? 'Token consumption over time' : 'Sessions over time'}
            /**
             * How many of these buckets are not empty. The chart draws every day in the window,
             * which is right — a gap is information — but it leaves a reader dividing the total by the
             * window's LENGTH. In a real local history that is 29 of 30 at the default range and 37 of 90 at
             * the widest, so the same total is 2.4x denser than the axis suggests.
             */
            action={
              <span className="text-2xs tabular-nums text-text-faint">
                {stats.activeDays} of {trend.length} days active
              </span>
            }
          >
            <TrendChart
              points={trend}
              formatValue={(value) =>
                hasUsage
                  ? `${formatTokens(value)} tokens`
                  : `${value} session${value === 1 ? '' : 's'}`
              }
              // A long window is bucketed by week, and the axis has to say so — a bar silently
              // holding seven days reads as a day with implausible traffic.
              bucketLabel={stats.bucketDays > 1 ? 'week' : 'day'}
              emptyLabel="No sessions in this range"
            />
          </StatSection>

          <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
            {/* Named only while a drill is active: the bars deliberately still total more than the
                Sessions tile, and unexplained that reads as an arithmetic error rather than as the
                comparison you are choosing from. */}
            <StatSection
              title={selectedProvider ? 'By agent — all agents, for comparison' : 'By agent'}
            >
              <DistributionChart
                rows={byProvider}
                formatValue={(value) => (hasUsage ? formatTokens(value) : String(value))}
                labelKey={(key) => providerNames.get(key) ?? key}
                // Every agent stays listed while one is selected: this is the control the filter is
                // driven from, and a control that deletes its own options is a dead end.
                onSelect={onSelectProvider}
                selectedKey={selectedProvider}
                emptyLabel="No agents with history here"
                overflowLabel={(hidden) => `+${hidden} not drawn`}
              />
            </StatSection>
            {/* One slot, two axes — models when usage was measured, projects when it was not; the
                handler follows whichever is drawn. The dedicated project section below covers the
                other case, so neither leaves the reader without a project breakdown. */}
            <StatSection title={hasUsage ? 'By model' : projectAxisTitle(stats)}>
              <DistributionChart
                rows={hasUsage ? byModel : byProject}
                {...(hasUsage
                  ? onSelectModel
                    ? {
                        onSelect: onSelectModel,
                        ...(selectedModel ? { selectedKey: selectedModel } : {}),
                      }
                    : {}
                  : onSelectProject
                    ? {
                        onSelect: onSelectProject,
                        isSelectable: (key: string) => key !== NO_CWD_BUCKET,
                        ...(selectedProject ? { selectedKey: selectedProject } : {}),
                      }
                    : {})}
                formatValue={(value) => (hasUsage ? formatTokens(value) : String(value))}
                labelKey={(key) => (hasUsage ? key : middleEllipsis(key))}
                emptyLabel={hasUsage ? 'No models recorded' : 'No working directories recorded'}
                // TWO truncations, not one. The chart draws a top eight and reports what IT dropped;
                // the fold had already capped the axis at twelve buckets. Measured here: 17 projects
                // distinct, 12 kept, 8 drawn — so the bar read "+4 not drawn" while 9 were, and the
                // 5 dropped upstream held 17 sessions no figure on the screen accounted for.
                overflowLabel={(hidden) =>
                  `+${hidden + (hasUsage ? 0 : Math.max(0, stats.projects - stats.byProject.length))} not drawn`
                }
              />
            </StatSection>
          </div>

          {hasUsage && (
            <>
              <StatSection title={projectAxisTitle(stats)}>
                <DistributionChart
                  rows={byProject}
                  formatValue={formatTokens}
                  labelKey={(key) => middleEllipsis(key)}
                  emptyLabel="No working directories recorded"
                  // TWO truncations, not one. The chart draws a top eight and reports what IT dropped;
                  // the fold had already capped the axis at twelve buckets. Measured here: 17 projects
                  // distinct, 12 kept, 8 drawn — so the bar read "+4 not drawn" while 9 were, and the
                  // 5 dropped upstream held 17 sessions no figure on the screen accounted for.
                  overflowLabel={(hidden) =>
                    `+${hidden + Math.max(0, stats.projects - stats.byProject.length)} not drawn`
                  }
                  {...(onSelectProject
                    ? {
                        onSelect: onSelectProject,
                        isSelectable: (key: string) => key !== NO_CWD_BUCKET,
                        ...(selectedProject ? { selectedKey: selectedProject } : {}),
                      }
                    : {})}
                />
              </StatSection>
              {/*
              Every other axis aggregates, which hides how concentrated the spend is: measured here,
              10 sessions of 212 hold 53% of all tokens while the project axis folds 151 of them into
              one bar. It FILTERS rather than opens — a bucket carries a key and a title but no cwd, so
              opening from it would hand the import action a session with no project. Filtering by the
              key puts the complete row in front of the reader, who opens that.
            */}
              {delegating.length > 0 && (
                /* Sub-agents are hidden from the list by default and are most of what exists —
                   1,283 of 1,535 sessions here, belonging to 55 parents. The section renders only
                   when something delegated, because an empty axis about delegation reads as "nobody
                   delegates" rather than "this window has no parents in it". */
                <StatSection title="Most delegating sessions">
                  <DistributionChart
                    rows={delegating}
                    formatValue={(value) => `${value} sub-agent${value === 1 ? '' : 's'}`}
                    labelKey={(key) => delegatingLabels.get(key) ?? key}
                    emptyLabel="No session spawned a sub-agent in this range"
                    overflowLabel={(hidden) => `+${hidden} more ranked below the top eight`}
                    {...(onSelectParent ? { onSelect: onSelectParent } : {})}
                  />
                </StatSection>
              )}
              <StatSection title={heaviestAxisTitle(stats)}>
                <DistributionChart
                  rows={heaviest}
                  formatValue={formatTokens}
                  labelKey={(key) => heaviestLabels.get(key) ?? key}
                  emptyLabel="No session reported its own usage"
                  overflowLabel={(hidden) => `+${hidden} more ranked below the top eight`}
                  {...(onSelectSession ? { onSelect: onSelectSession } : {})}
                />
              </StatSection>
            </>
          )}

          {stats.firstAt !== undefined && stats.lastAt !== undefined && (
            <p className="text-2xs text-text-faint">
              All history on this machine spans {new Date(stats.firstAt).toLocaleDateString()} –{' '}
              {new Date(stats.lastAt).toLocaleDateString()}.{' '}
              {stats.usage
                ? `Usage is provider-reported for ${stats.usageSessions} of ${stats.sessions} sessions in range; no API-price estimate is presented as billed cost.`
                : 'These history records do not expose measured token usage.'}
              {stats.messages === undefined ? '' : ` ${stats.messages.toLocaleString()} messages.`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The ranges offered. The same ladder our own usage stats offer, because a reader comparing the two
 * screens should not have to re-learn what "recent" means on each.
 *
 * The widest rung is `MAX_STATS_DAYS` from `shared/contracts` — the bound the request schemas
 * validate against. Widening it here without widening that would make the top of the ladder a 400.
 */
export type StatsDays = '7' | '30' | '90' | '365'

export const STATS_RANGES: { id: StatsDays; label: string }[] = [
  { id: '7', label: '7d' },
  { id: '30', label: '30d' },
  { id: '90', label: '90d' },
  { id: '365', label: '1y' },
]

/** Spelled out, because "30d" beside a number is a legend and the scope line is a sentence. */
const RANGE_SCOPE: Record<StatsDays, string> = {
  '7': 'the last 7 days',
  '30': 'the last 30 days',
  '90': 'the last 90 days',
  '365': 'the last year',
}

/** Compact duration — a session is minutes or hours, never days, so two units is the whole range. */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatCacheRate(usage: NonNullable<ExternalAgentStats['usage']>): string {
  const prompt = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens
  if (prompt <= 0) return '—'
  return `${Math.round((usage.cachedInputTokens / prompt) * 100)}%`
}
