import type { SystemSnapshot } from '../../shared/system'
import { formatBytes } from '../../shared/system'
import { TrendChart } from '@localixai/plugin-sdk/ui/stats-charts'

/**
 * Chart keys are LOCAL clock times, not the snapshot's ISO timestamp. The SDK labels
 * each bucket from its key and knows day/hour keys; an ISO string fell through as
 * `Sep 22 08:00:00.000Z` — three of those in one caption. A `HH:MM:SS` key is shown
 * verbatim and is unique at the 3s polling cadence.
 */
function clockKey(capturedAt: string): string {
  return new Date(capturedAt).toLocaleTimeString(undefined, { hour12: false })
}

export function SystemCharts({ history }: { history: readonly SystemSnapshot[] }) {
  const cpu = history.flatMap((sample) =>
    sample.cpu.usagePercent === null
      ? []
      : [
          {
            key: clockKey(sample.capturedAt),
            value: sample.cpu.usagePercent,
            detail: `${sample.cpu.logicalCores} logical cores`,
          },
        ],
  )
  const memory = history.map((sample) => ({
    key: clockKey(sample.capturedAt),
    value: sample.memory.usedBytes,
    detail: `${Math.round((sample.memory.usedBytes / Math.max(1, sample.memory.totalBytes)) * 100)}% used`,
  }))
  return (
    <section aria-label="Recent activity" className="grid gap-3 @3xl:grid-cols-2">
      <Chart title="CPU history" detail="Last 30 visible samples">
        <TrendChart
          points={cpu}
          formatValue={(value) => `${value.toFixed(1)}%`}
          bucketLabel="sample"
          emptyLabel="Collecting CPU history…"
        />
      </Chart>
      <Chart title="Memory history" detail="Memory in use">
        <TrendChart
          points={memory}
          formatValue={formatBytes}
          bucketLabel="sample"
          emptyLabel="Collecting memory history…"
        />
      </Chart>
    </section>
  )
}

function Chart({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-4">
      <div className="mb-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-1 text-xs text-text-faint">{detail}</p>
      </div>
      {children}
    </div>
  )
}
