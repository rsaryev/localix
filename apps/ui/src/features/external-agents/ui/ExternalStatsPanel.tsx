import { useState } from 'react'
import { StatCard } from '@localixai/kit/stat'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { Segmented } from '@localixai/plugin-sdk/ui/segmented-control'
import { formatTokens, errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { FilterMenu } from '@/shared/ui/FilterMenu'
import { ActiveFilterChips } from '@/shared/ui/ActiveFilterChips'
import { ProblemState, useProblemReport } from '@/shared/ui/problem-report'
import { toast } from '@/shared/lib/notify'
import { loadExternalSession, openExternalSession } from '../model/openSession'
import {
  useExternalStats,
  type ExternalStatsRange,
  type ExternalStatsFilters,
} from '../model/useExternalStats'
import { externalCacheRate, type ExternalStatsGroup } from '../model/statsPresentation'
import { ExternalStatsCharts } from './ExternalStatsCharts'

const RANGES: { id: ExternalStatsRange; label: string }[] = [
  { id: '7', label: '7d' },
  { id: '30', label: '30d' },
  { id: '90', label: '90d' },
  { id: '365', label: '1y' },
]
const GROUPS: { id: ExternalStatsGroup; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'project', label: 'Project' },
  { id: 'model', label: 'Model' },
]

export default function ExternalStatsPanel() {
  const [range, setRange] = useState<ExternalStatsRange>('30')
  const [group, setGroup] = useState<ExternalStatsGroup>('agent')
  const [filters, setFilters] = useState<ExternalStatsFilters>({
    provider: '',
    project: '',
    model: '',
  })
  const query = useExternalStats(range, filters)
  const stats = query.stats
  const names = new Map(query.agents.map((agent) => [agent.id as string, agent.name]))
  const setFilter = (key: keyof ExternalStatsFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }))
  const axisFilter = group === 'agent' ? 'provider' : group
  const problem = useProblemReport(
    query.error
      ? {
          subject: { label: 'External agent statistics' },
          consequence: 'blocked',
          problems: [
            {
              message: 'Could not read agent usage.',
              detail: errorMessage(query.error, '') || undefined,
            },
          ],
        }
      : null,
    {
      scope: 'external-agent-stats',
      actions: [{ id: 'retry', label: 'Retry', run: query.refresh }],
    },
  )
  const openSession = async (key: string) => {
    try {
      const source = await loadExternalSession(key)
      await openExternalSession(source, null)
    } catch (error) {
      toast.error('Could not open this agent session', {
        description: errorMessage(error, '') || undefined,
      })
    }
  }
  if (problem) return <ProblemState {...problem} />
  if (query.loading && !stats) return <LoadingHint>Reading agent usage…</LoadingHint>
  if (!query.agents.length) return <EmptyHint>No supported agent CLI is installed.</EmptyHint>

  return (
    <div className="h-full overflow-y-auto px-6 py-5 scrollbar-thin">
      <div className="@container flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented aria-label="Time range" options={RANGES} value={range} onChange={setRange} />
            <Segmented
              aria-label="Group usage by"
              options={GROUPS}
              value={group}
              onChange={setGroup}
            />
            <FilterMenu
              label="Filter usage"
              className="ml-auto"
              facets={[
                {
                  id: 'agent',
                  label: 'Agent',
                  value: filters.provider,
                  allValue: '',
                  options: [
                    { value: '', label: 'All agents' },
                    ...query.agents.map((agent) => ({ value: agent.id, label: agent.name })),
                  ],
                  onChange: (value) => setFilter('provider', value),
                },
                {
                  id: 'project',
                  label: 'Project',
                  value: filters.project,
                  allValue: '',
                  options: [
                    { value: '', label: 'All projects' },
                    ...(stats?.byProject ?? [])
                      .filter((row) => row.key !== 'no working directory recorded')
                      .map((row) => ({ value: row.key, label: row.key })),
                  ],
                  onChange: (value) => setFilter('project', value),
                },
                {
                  id: 'model',
                  label: 'Model',
                  value: filters.model,
                  allValue: '',
                  options: [
                    { value: '', label: 'All models' },
                    ...(stats?.byModel ?? []).map((row) => ({ value: row.key, label: row.key })),
                  ],
                  onChange: (value) => setFilter('model', value),
                },
              ]}
            />
          </div>
          <ActiveFilterChips
            chips={(Object.keys(filters) as (keyof ExternalStatsFilters)[]).flatMap((id) =>
              filters[id]
                ? [
                    {
                      id,
                      field: id === 'provider' ? 'Agent' : id === 'project' ? 'Project' : 'Model',
                      label:
                        id === 'provider' ? (names.get(filters[id]) ?? filters[id]) : filters[id],
                    },
                  ]
                : [],
            )}
            onRemove={(id) => setFilter(id, '')}
            onClear={() => setFilters({ provider: '', project: '', model: '' })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
          <StatCard
            label="Tokens processed"
            value={stats?.usage ? formatTokens(stats.usage.totalTokens) : '—'}
            title={
              stats?.usage
                ? `${formatTokens(stats.usage.inputTokens + stats.usage.outputTokens)} fresh input and output tokens.`
                : 'No provider-reported token usage.'
            }
          />
          <StatCard label="Sessions" value={stats ? stats.sessions : '—'} />
          <StatCard label="Cache hit" value={externalCacheRate(stats?.usage)} hint="of input" />
          <StatCard
            label="Requests"
            value={stats?.usage ? formatTokens(stats.usage.requests) : '—'}
          />
        </div>
        {stats?.sessions ? (
          <>
            <ExternalStatsCharts
              stats={stats}
              group={group}
              names={names}
              selected={filters[axisFilter]}
              onSelect={(key) => {
                if (group !== 'project' || key !== 'no working directory recorded')
                  setFilter(axisFilter, key)
              }}
              onOpenSession={(key) => {
                void openSession(key)
              }}
            />
          </>
        ) : (
          <EmptyHint>
            No agent sessions in this range. Choose a wider range or clear the filters.
          </EmptyHint>
        )}
        {Boolean(stats?.outsideRange.length) && (
          <p className="text-2xs text-text-faint">
            {stats?.outsideRange
              .map((row) => `${names.get(row.key) ?? row.key}: ${row.sessions}`)
              .join(' · ')}{' '}
            sessions outside this range.
          </p>
        )}
      </div>
    </div>
  )
}
