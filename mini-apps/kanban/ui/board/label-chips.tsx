import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { kanbanLabelTone } from '../model/kanbanLabel'

/**
 * A task's labels, as chips.
 *
 * Presentation only, and deliberately identical on a card and in the detail
 * header — a label's job is to be recognized at a glance, which fails if the same
 * name reads differently in two places. `onRemove` turns each chip into its own
 * button; without it they are plain spans, so a card cannot be edited by a stray
 * click while dragging.
 */
export function LabelChips({
  labels,
  className,
  onRemove,
}: {
  labels: readonly string[]
  className?: string
  onRemove?: (label: string) => void
}) {
  if (labels.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {labels.map((label) =>
        onRemove ? (
          <button
            key={label}
            type="button"
            onClick={() => onRemove(label)}
            title={`Remove label “${label}”`}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-2xs leading-none outline-none transition-opacity focus-ring hover:opacity-70',
              kanbanLabelTone(label),
            )}
          >
            {label}
          </button>
        ) : (
          <span
            key={label}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-2xs leading-none',
              kanbanLabelTone(label),
            )}
          >
            {label}
          </span>
        ),
      )}
    </div>
  )
}
