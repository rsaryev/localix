import type { ReactNode } from 'react'
import { ChipRemoveButton } from './ChipRemoveButton'

interface CommandTokenProps {
  /** Leading command glyph, sized `size-3` by the caller. */
  icon?: ReactNode
  label: string
  /** Hover tooltip (defaults to the label). */
  title?: string
  /** Slightly heavier label (the active slash-command chip). */
  emphasis?: boolean
  onRemove?: () => void
  removeLabel?: string
}

/** Flat token for an active slash command or one of its selected arguments. */
export function CommandToken({
  icon,
  label,
  title,
  emphasis,
  onRemove,
  removeLabel,
}: CommandTokenProps) {
  return (
    <span
      title={title ?? label}
      className={[
        'inline-flex max-w-56 items-center gap-1 px-1 py-0.5 text-xs text-text-soft',
        emphasis ? 'font-medium text-foreground' : '',
      ].join(' ')}
    >
      {icon !== undefined && <span className="shrink-0 text-text-soft">{icon}</span>}
      <span className="min-w-0 truncate">{label}</span>
      {onRemove && (
        <ChipRemoveButton label={removeLabel ?? `Remove ${label}`} onRemove={onRemove} />
      )}
    </span>
  )
}
