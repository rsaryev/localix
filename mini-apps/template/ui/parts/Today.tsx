import { ContextRing } from '@localixai/kit/context-ring'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { SectionLabel } from '@localixai/kit/section-label'
import type { Summary } from '../../shared/model'

/**
 * The day at a glance: the total as the hero number inside a ring of progress toward the goal,
 * and what each category added. The first thing a person looks at, so it is the largest.
 */
export function Today({ summary }: { summary: Summary }) {
  const { unit, dailyGoal } = summary.settings
  const percent = Math.round(summary.progress * 100)
  return (
    <section aria-label="Today" className="grid gap-6 @lg:grid-cols-[auto_1fr] @lg:items-center">
      <div className="relative mx-auto size-40 text-status-success">
        <ContextRing
          fraction={summary.progress}
          size={160}
          radius={10}
          strokeWidth={1.6}
          aria-label={`${percent}% of today's goal`}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {format(summary.today)}
          </span>
          <span className="text-xs text-text-faint">
            of {dailyGoal} {unit}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-soft">
          {summary.left > 0 ? (
            <>
              <span className="font-medium text-foreground">
                {format(summary.left)} {unit} left
              </span>{' '}
              to today’s goal
            </>
          ) : (
            <span className="font-medium text-status-success">Goal reached today</span>
          )}
        </p>
        {summary.byCategory.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <SectionLabel size="2xs">By category</SectionLabel>
            {summary.byCategory.map((category) => (
              <div key={category.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-text-soft">{category.key}</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {format(category.value)} {unit}
                  </span>
                </div>
                <ProgressBar
                  value={summary.today ? (category.value / summary.today) * 100 : 0}
                  className="h-1.5"
                  aria-label={`${category.key}: ${format(category.value)} ${unit}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const format = (value: number) => String(Math.round(value * 10) / 10)
