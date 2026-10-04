import { useMemo, useState } from 'react'
import { StatCard, StatSection } from '@localixai/kit/stat'
import {
  useUsageOverview,
  useUsageLogs,
  useUsageKeys,
  type UsageFilters,
  type UsageGroupBy,
  type UsageRange,
} from '@/shared/hooks/useUsageStats'
import { TrendChart, DistributionChart } from '@localixai/plugin-sdk/ui/stats-charts'
import { LogsTable } from './LogsTable'
import { agentLabel, formatTokens, formatUsd, kindLabel, providerLabel, shortKey } from './format'
import { cacheHitRate } from '@/features/chat/model/usageMath'
import { BreakdownTable } from './StatsControls'
import { StatsFilterBar } from './StatsFilterBar'
import { StateNotice } from '@localixai/kit/state-notice'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

const GROUP_TITLE: Record<UsageGroupBy, string> = {
  model: 'Cost by model',
  provider: 'Cost by provider',
  kind: 'Cost by kind',
  agent: 'Cost by agent',
}

export function StatsPanel({ onOpenSession }: { onOpenSession?: (sessionId: string) => void }) {
  const [range, setRange] = useState<UsageRange>('30d')
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('model')
  const [filters, setFilters] = useState<UsageFilters>({})
  // Freeze the range anchor for this mount so query keys stay stable across renders.
  const [nowMs] = useState(() => Date.now())

  const { keys } = useUsageKeys()
  const { overview, error, refetch } = useUsageOverview(range, groupBy, nowMs, filters)
  const logs = useUsageLogs(range, nowMs, filters)
  const summary = overview?.summary
  const stats = overview?.stats ?? []
  const trend = overview?.trend ?? []

  // Cache-hit rate: cached reads as a fraction of total context (inputTokens includes cacheRead+cacheWrite).
  const cacheRate = cacheHitRate(summary?.cacheReadTokens, summary?.inputTokens)
  // Cost provenance: all rows provider-reported → "actual"; all subscription
  // → "plan (est.)"; none actual and no subscription → "estimated"; a mix →
  // show what share is estimated instead of a misleading blanket label.
  const costHint =
    summary && summary.messages > 0
      ? summary.actualCostMessages === summary.messages
        ? { text: 'actual', tone: 'good' as const }
        : summary.actualCostMessages === 0 && summary.subscriptionMessages === summary.messages
          ? { text: 'plan (est.)', tone: 'muted' as const }
          : summary.actualCostMessages === 0
            ? { text: 'estimated', tone: 'muted' as const }
            : {
                text: `${Math.round(((summary.messages - summary.actualCostMessages) / summary.messages) * 100)}% estimated`,
                tone: 'muted' as const,
              }
      : undefined
  // Mounted whatever the state of the read, and handed `null` while it works, so the Event Center
  // row settles as soon as the ledger answers again.
  const problem = useProblemReport(
    error
      ? {
          subject: { label: 'Usage & spend' },
          // The panel draws nothing behind this: the report IS the surface.
          consequence: 'blocked',
          // No hint: `blocked` already says nothing is showing, and "stays unavailable until the
          // server answers" was that same fact a second time rather than something to do.
          problems: [
            {
              message: 'The usage ledger could not be read.',
              detail: errorMessage(error, '') || undefined,
            },
          ],
        }
      : null,
    { scope: 'stats', actions: [{ id: 'retry', label: 'Retry', run: refetch }] },
  )

  const setFilter = (k: keyof UsageFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }))
  // 'kind' is a derived category (turn/title/…) with no ledger filter
  // column, so its breakdown is read-only; the rest drill down into filters.
  const drillKey: keyof UsageFilters | null = groupBy === 'kind' ? null : groupBy

  // Filter dropdown options derive only from `keys` — memoize so the filter bar's
  // children get stable option arrays across unrelated re-renders.
  const fields = useMemo(
    () => [
      {
        id: 'model' as const,
        label: 'Model',
        options: (keys?.models ?? []).map((m) => ({ value: m, label: shortKey(m) })),
      },
      {
        id: 'provider' as const,
        label: 'Provider',
        options: (keys?.providers ?? []).map((p) => ({ value: p, label: providerLabel(p) })),
      },
      {
        id: 'agent' as const,
        label: 'Agent',
        options: (keys?.agents ?? []).map((a) => ({ value: a.id, label: agentLabel(a) })),
      },
      {
        id: 'session' as const,
        label: 'Session',
        options: (keys?.sessions ?? []).map((s) => ({
          value: s.id,
          label: s.title ?? s.id.slice(0, 8),
        })),
      },
    ],
    [keys],
  )
  // The breakdown and chart label a grouped row by the same rule the filter menu names it by,
  // so a row and the filter it sets read identically instead of one showing "builtin:qa" and
  // the other "qa". `agentHandles` is that map for the agent grouping.
  const agentHandles = useMemo(
    () => new Map((keys?.agents ?? []).map((a) => [a.id, agentLabel(a)])),
    [keys],
  )
  const groupLabelFn =
    groupBy === 'kind'
      ? kindLabel
      : groupBy === 'agent'
        ? // Rows with no speaker — the background calls a room makes for itself (titles,
          // prompt improvement) — group under the repository's 'unknown' key. Naming the bucket keeps the
          // breakdown adding up to the summary card instead of appearing to lose spend.
          (key: string) => agentHandles.get(key) ?? (key === 'unknown' ? 'No agent' : shortKey(key))
        : shortKey
  // Drilling into that bucket would filter by an agent id nobody has, so it is not a link.
  const selectableKey = (key: string) => groupBy !== 'agent' || key !== 'unknown'
  const onDrill = drillKey
    ? (key: string) => {
        if (selectableKey(key)) setFilter(drillKey, key)
      }
    : undefined

  // No ground coat: the hosting pane already paints one, and under the macOS glass theme the
  // ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* No header here: the inspector tab strip already shows the "Usage & Spend"
          title, icon, and close/maximize controls — a PanelHeader would duplicate it. */}
      {problem ? (
        <StateNotice
          title="Usage & spend"
          // The shell centres and names the pane; the sentence, the exact text and the Event
          // Center row are ProblemLine's — repeating "Could not load usage data" here made the
          // same fact appear twice in two different voices.
          body={<ProblemLine {...problem} className="items-center" />}
        />
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
          <div className="@container flex flex-col gap-5">
            <StatsFilterBar
              range={range}
              onRange={setRange}
              groupBy={groupBy}
              onGroupBy={setGroupBy}
              filters={filters}
              onFilter={setFilter}
              onClear={() => setFilters({})}
              fields={fields}
            />

            <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
              <StatCard
                label="Total spend"
                value={summary ? formatUsd(summary.costUsd) : '—'}
                hint={costHint?.text}
                hintTone={costHint?.tone}
              />
              <StatCard
                label="Total tokens"
                value={summary ? formatTokens(summary.totalTokens) : '—'}
              />
              <StatCard
                label="Cache hit"
                value={cacheRate !== null ? `${cacheRate}%` : '—'}
                hint="of input"
              />
              <StatCard label="Messages" value={summary ? formatTokens(summary.messages) : '—'} />
            </div>

            {/* Charts pair up only when the PANEL is wide enough (container query,
                not viewport — the panel can be narrow on a wide screen). */}
            <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
              <StatSection title="Spend over time">
                <TrendChart
                  points={trend.map((point) => ({
                    key: point.day,
                    value: point.costUsd,
                    detail: `${formatTokens(point.totalTokens)} tok`,
                  }))}
                  formatValue={formatUsd}
                  bucketLabel={range === '7d' ? 'hr' : 'day'}
                  emptyLabel="No spend in this range yet"
                />
              </StatSection>
              <StatSection title={GROUP_TITLE[groupBy]}>
                <DistributionChart
                  rows={stats.map((row) => ({ key: row.key, value: row.costUsd }))}
                  formatValue={formatUsd}
                  onSelect={onDrill}
                  selectedKey={drillKey ? filters[drillKey] : undefined}
                  labelKey={groupLabelFn}
                />
              </StatSection>
            </div>
            <StatSection title="Breakdown">
              <BreakdownTable
                rows={stats}
                totalCost={summary?.costUsd ?? 0}
                onSelect={onDrill}
                selectedKey={drillKey ? filters[drillKey] : undefined}
                labelKey={groupLabelFn}
              />
            </StatSection>
            <StatSection title="Requests">
              <LogsTable
                rows={logs.rows}
                isLoading={logs.isLoading}
                isLoadingMore={logs.isLoadingMore}
                hasMore={logs.hasMore}
                error={logs.error}
                onLoadMore={logs.loadMore}
                onOpenSession={onOpenSession}
              />
            </StatSection>
          </div>
        </div>
      )}
    </div>
  )
}
