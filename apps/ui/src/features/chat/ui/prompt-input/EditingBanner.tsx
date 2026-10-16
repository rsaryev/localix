import { Pencil, X } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'

/**
 * Compact "Editing" banner shown above the composer input while a past
 * message is loaded for editing: an edit glyph + "Editing" label + a one-line
 * preview of the original message, and an × to cancel (Esc also cancels). Reuses
 * the composer's monochrome-token chrome: a subtle left accent rule rather
 * than a second card floating above the input.
 */
export function EditingBanner({
  originalText,
  onCancel,
}: {
  originalText: string
  onCancel: () => void
}) {
  const preview = originalText.replace(/\s+/g, ' ').trim() || 'Empty message'
  return (
    <div className="mb-2 flex items-center gap-2 border-l-2 border-l-status-info/60 py-0.5 pl-2.5">
      <Pencil className="size-3.5 shrink-0 text-status-info" />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-2xs font-semibold text-status-info">Editing</span>
        <span className="truncate text-xs text-text-soft" title={preview}>
          {preview}
        </span>
      </div>
      <IconButton
        size="sm"
        onClick={onCancel}
        aria-label="Cancel editing"
        tooltip="Cancel editing (Esc)"
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
