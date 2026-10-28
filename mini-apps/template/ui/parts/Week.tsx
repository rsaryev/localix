import { SectionLabel } from '@localixai/kit/section-label'
import { TrendChart } from '@localixai/mini-app-sdk/ui/stats-charts'
import type { Summary } from '../../shared/model'

/** The last seven days as bars, today last: the trend a single day cannot show. */
export function Week({ summary }: { summary: Summary }) {
  const { unit } = summary.settings
  return (
    <section aria-label="Last 7 days" className="flex flex-col gap-3">
      <SectionLabel size="2xs">Last 7 days</SectionLabel>
      <TrendChart
        points={summary.week}
        formatValue={(value) => `${Math.round(value)} ${unit}`}
        emptyLabel="Nothing logged this week yet"
      />
    </section>
  )
}
