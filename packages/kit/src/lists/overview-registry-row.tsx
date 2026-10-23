import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'

export interface OverviewRegistryMetric {
  label: string
  value: ReactNode
  icon?: LucideIcon
}

/**
 * Flat navigation row shared by mini app overview screens. The workbench already
 * supplies the containing surface, so this keeps hierarchy in typography,
 * dividers, and hover rather than nesting another card.
 */
export function OverviewRegistryRow({
  title,
  description,
  icon: Icon,
  metrics,
  onOpen,
}: {
  title: string
  description?: string
  icon: LucideIcon
  metrics: OverviewRegistryMetric[]
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-slot="overview-registry-row"
      className="group w-full border-y border-border-soft px-1 py-3 text-left outline-none transition-colors hover:bg-surface-hover/45 focus-ring"
    >
      <span className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-text-soft" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          {description && (
            <span className="mt-0.5 block text-xs leading-relaxed text-text-faint">
              {description}
            </span>
          )}
          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {metrics.map(({ label, value, icon: MetricIcon }) => (
              <span key={label} className="inline-flex min-w-0 items-center gap-1.5 text-2xs">
                {MetricIcon && <MetricIcon className="size-3 shrink-0 text-text-faint" />}
                <span className="text-text-faint">{label}</span>
                <span className="font-medium tabular-nums text-foreground">{value}</span>
              </span>
            ))}
          </span>
        </span>
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}
