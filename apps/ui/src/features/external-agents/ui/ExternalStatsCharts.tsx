import { StatSection } from '@localixai/kit/stat'
import { DistributionChart, TrendChart } from '@localixai/plugin-sdk/ui/stats-charts'
import { formatTokens } from '@localixai/plugin-sdk/ui/utilities'
import type { ExternalAgentStats } from '@localixai/api/external-agent-contracts'
import {
  externalStatsAxis,
  statsBucketLabels,
  type ExternalStatsGroup,
} from '../model/statsPresentation'

export function ExternalStatsCharts({
  stats,
  group,
  names,
  selected,
  onSelect,
  onOpenSession,
}: {
  stats: ExternalAgentStats
  group: ExternalStatsGroup
  names: ReadonlyMap<string, string>
  selected: string
  onSelect: (key: string) => void
  onOpenSession: (key: string) => void
}) {
  const axis = externalStatsAxis(stats, group)
  const formatValue = axis.measured ? formatTokens : (value: number) => value.toLocaleString()
  const sessionNames = statsBucketLabels(stats.topSessions)
  const parentNames = statsBucketLabels(stats.byParent)
  const label = (key: string) => (group === 'agent' ? (names.get(key) ?? key) : key)
  const bound =
    group === 'project' && stats.projects > axis.rows.length
      ? `, ${axis.rows.length} of ${stats.projects} projects`
      : ''
  return (
    <>
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
        <StatSection
          title={axis.measured ? 'Token consumption over time' : 'Sessions over time'}
          action={<span className="text-2xs text-text-faint">{stats.activeDays} days active</span>}
        >
          <TrendChart
            points={stats.byDay.map((day) => ({
              key: day.key,
              value: axis.measured ? (day.usage?.totalTokens ?? 0) : day.sessions,
            }))}
            formatValue={formatValue}
            bucketLabel="day"
            emptyLabel="No activity in this range"
          />
        </StatSection>
        <StatSection title={`${axis.measured ? 'Tokens' : 'Sessions'} by ${group}${bound}`}>
          <DistributionChart
            rows={axis.points}
            formatValue={formatValue}
            labelKey={label}
            onSelect={onSelect}
            selectedKey={selected || undefined}
          />
        </StatSection>
      </div>
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
        <StatSection
          title={
            stats.topSessions.length < stats.usageSessions
              ? `Heaviest sessions of ${stats.usageSessions} measured`
              : 'Heaviest sessions'
          }
        >
          <DistributionChart
            rows={stats.topSessions.map((row) => ({
              key: row.key,
              value: row.usage?.totalTokens ?? 0,
            }))}
            formatValue={formatTokens}
            labelKey={(key) => sessionNames.get(key) ?? key}
            onSelect={onOpenSession}
          />
        </StatSection>
        <StatSection title="Delegation by session">
          <DistributionChart
            rows={stats.byParent.map((row) => ({ key: row.key, value: row.sessions }))}
            formatValue={(value) => value.toLocaleString()}
            labelKey={(key) => parentNames.get(key) ?? key}
            onSelect={onOpenSession}
          />
        </StatSection>
      </div>
    </>
  )
}
