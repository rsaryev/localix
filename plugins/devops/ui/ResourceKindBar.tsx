import type { ComponentType } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { handleResourceTabKeyDown } from './resourceTabs'

export interface ResourceKindMeta {
  label: string
  shortLabel: string
  icon: ComponentType<{ className?: string }>
}

/** Provider-neutral resource tabs used by both Docker and Kubernetes inventories. */
export function ResourceKindBar<Resource extends string>({
  ariaLabel,
  value,
  order,
  meta,
  counts,
  errors,
  onChange,
}: {
  ariaLabel: string
  value: Resource
  order: readonly Resource[]
  meta: Record<Resource, ResourceKindMeta>
  counts: Record<Resource, number>
  errors?: Partial<Record<Resource, unknown>>
  onChange: (value: Resource) => void
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={(event) => handleResourceTabKeyDown(event, order, value, onChange)}
      className="flex flex-wrap items-center gap-1 border-b border-border-soft px-3 py-2"
    >
      {order.map((resource) => {
        const item = meta[resource]
        const Icon = item.icon
        const selected = resource === value
        return (
          <button
            key={resource}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={item.label}
            onClick={() => onChange(resource)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs outline-none transition-colors focus-ring',
              selected
                ? 'bg-surface-active text-foreground'
                : 'text-text-faint hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span>{item.shortLabel}</span>
            {/* Foreground veil, not `bg-background/70`: `--background` is the pane's own ground, so
                on a tab that already carries the selected/hover veil the count pill read as a
                darker hole punched into it. A veil only adds density to what it covers. */}
            <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-2xs tabular-nums opacity-80">
              {counts[resource]}
            </span>
            {Boolean(errors?.[resource]) && (
              <span
                aria-label={`${item.label} temporarily unavailable`}
                className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-status-warning/80"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
