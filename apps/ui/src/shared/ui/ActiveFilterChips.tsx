import { X } from 'lucide-react'
import { TextAction } from '@localixai/kit/text-action'

export function ActiveFilterChips<Id extends string>({
  chips,
  onRemove,
  onClear,
}: {
  chips: readonly { id: Id; field: string; label: string }[]
  onRemove: (id: Id) => void
  onClear: () => void
}) {
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemove(chip.id)}
          title={`Remove the ${chip.field.toLowerCase()} filter`}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-hover py-0.5 pl-2 pr-1.5 text-xs text-text-soft ring-1 ring-border-soft outline-none transition-colors hover:text-foreground focus-ring"
        >
          <span className="text-text-faint">{chip.field}</span>
          <span className="truncate text-foreground">{chip.label}</span>
          <X className="size-3 shrink-0 opacity-60" aria-hidden />
        </button>
      ))}
      <TextAction
        onClick={onClear}
        className="rounded-md px-1.5 py-0.5 text-xs text-text-faint hover:text-foreground"
      >
        Clear all
      </TextAction>
    </div>
  )
}
