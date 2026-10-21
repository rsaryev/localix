import { X } from 'lucide-react'

/**
 * The × inside a composer token — a pinned skill, a command token. Sized to the chip's text line
 * (16px) rather than to a control rung, because it lives INSIDE a pill that is itself the control
 * height; a 20px IconButton would push the pill taller than its neighbours.
 *
 * Both tokens spelled this button out byte for byte, so a retune of one left the other behind.
 */
export function ChipRemoveButton({
  label,
  onRemove,
}: {
  /** Accessible name — also the tooltip, since the glyph alone does not say what goes. */
  label: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onRemove}
      className="ml-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
    >
      <X className="size-3" aria-hidden="true" />
    </button>
  )
}
