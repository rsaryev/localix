import { Paperclip, X } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import type { ComposerManifestRow } from '../../model/composerContextManifest'

/**
 * The upload half of the composer's context manifest: media, files and voice notes, rendered
 * as the same numbered rows the links use so the list reads as ONE inventory of what this
 * message carries — which is the question the popover exists to answer.
 */
export function ContextManifestUploads({
  rows,
  startIndex,
  onRemove,
}: {
  rows: readonly ComposerManifestRow[]
  /** Rows continue the link numbering rather than restarting at one. */
  startIndex: number
  onRemove?: (id: string) => void
}) {
  return rows.map((row, index) => (
    <div key={row.key} role="listitem" className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <span className="w-4 shrink-0 text-right text-2xs tabular-nums text-text-faint">
        {startIndex + index + 1}
      </span>
      {row.thumbnailUrl ? (
        <img src={row.thumbnailUrl} alt="" className="size-6 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="shrink-0 text-text-soft">
          <Paperclip className="size-3" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium" title={row.label}>
          {row.label}
        </div>
        <div className="flex items-center gap-1.5 text-2xs text-text-soft">
          <span>{row.source}</span>
          {row.size && <span>· {row.size}</span>}
        </div>
      </div>
      {onRemove && (
        <IconButton
          size="sm"
          onClick={() => onRemove(row.key)}
          className="shrink-0 text-text-soft opacity-65 hover:opacity-100"
          aria-label={`Remove attachment ${row.label}`}
        >
          <X />
        </IconButton>
      )}
    </div>
  ))
}
