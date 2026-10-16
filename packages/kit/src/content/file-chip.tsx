import { Children, type ReactNode } from 'react'
import { FileText, FileType2, X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { formatFileSize } from '@localixai/plugin-sdk/ui/utilities'

/**
 * The small round remove badge shared by image + generic chips. Exported so
 * chip-like siblings that FileChip can't own (e.g. the composer voice bubble,
 * whose player lives in a feature slice) reuse the exact same affordance. Reveals
 * on hover of an ancestor with the `group/att` class; always shown on focus.
 */
export function RemoveBadge({ onClick, floating }: { onClick: () => void; floating?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Chips may be wrapped in a button/link (image lightbox, download link) —
        // never let the remove click bubble into that.
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      aria-label="Remove attachment"
      title="Remove"
      className={cn(
        'flex size-4 items-center justify-center rounded-full bg-surface-active text-text-soft outline-none transition-opacity hover:bg-foreground hover:text-background focus-visible:opacity-100 focus-ring',
        // Reveal on hover of the chip; always visible on keyboard focus.
        'lx-hover-actions opacity-0 group-hover/att:opacity-100',
        floating && 'border border-control-border',
      )}
    >
      <X className="size-2.5" />
    </button>
  )
}

export interface FileChipProps {
  /** Only the chip kinds — image renders a thumbnail, file/text a generic icon chip.
   *  Audio + generated figures are NOT chips and are rendered by their own components. */
  kind: 'image' | 'file' | 'text'
  name: string
  size: number
  /** Resolved image source (blob object URL in the composer, media URL in the transcript). */
  imageSrc?: string
  /** Click a thumbnail (opens the lightbox). */
  onView?: () => void
  /** Remove this chip. Shown as a badge unless {@link readonly}. */
  onRemove?: () => void
  /** Read-only surfaces (the transcript) omit the remove badge. */
  readonly?: boolean
  /** Thumbnail size for the image kind — composer `size-12`, transcript `size-20`. */
  imageClassName?: string
  /** Extra classes for the generic (non-image) chip container (e.g. `h-12` to align). */
  className?: string
}

/**
 * One unified attachment chip — an image thumbnail, or a generic icon + name + size —
 * with an optional remove badge. Shared by the composer tray and the transcript
 * attachment display so both surfaces stay in visual + behavioural lockstep; the
 * `readonly` flag drops the remove affordance on the transcript side.
 */
export function FileChip({
  kind,
  name,
  size,
  imageSrc,
  onView,
  onRemove,
  readonly = false,
  imageClassName = 'size-12',
  className,
}: FileChipProps) {
  const removable = !readonly && Boolean(onRemove)

  if (kind === 'image' && imageSrc) {
    return (
      <div className="group/att relative shrink-0">
        <button
          type="button"
          onClick={onView}
          title={`View ${name}`}
          className="block outline-none focus-ring"
        >
          <img
            src={imageSrc}
            alt={name}
            className={cn(
              'cursor-pointer rounded-lg border border-control-border object-cover transition-[border-color,filter] hover:border-foreground/40 hover:brightness-95',
              imageClassName,
            )}
          />
        </button>
        {removable && (
          <div className="absolute -right-1.5 -top-1.5">
            <RemoveBadge floating onClick={onRemove!} />
          </div>
        )}
      </div>
    )
  }

  const Icon = kind === 'file' ? FileType2 : FileText
  return (
    <div
      className={cn(
        // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than the
        // composer/pane these chips sit on, so a row of attachments read as black cards.
        'group/att flex shrink-0 items-center gap-2 rounded-lg border border-control-border bg-field-fill py-1.5',
        removable ? 'pl-2.5 pr-1.5' : 'px-2.5',
        className,
      )}
      title={name}
    >
      <Icon className="size-4 shrink-0 text-text-soft" />
      <div className="flex min-w-0 flex-col">
        <span className="max-w-48 truncate text-2xs font-medium text-text-strong">{name}</span>
        <span className="text-2xs text-text-faint">{formatFileSize(size)}</span>
      </div>
      {removable && <RemoveBadge onClick={onRemove!} />}
    </div>
  )
}

/**
 * Lays out a group of file chips: a single chip sits bare; two or more scroll
 * horizontally so a long attachment set never wraps into a tall block. Pure layout —
 * chips (or any chip-like child, e.g. a voice bubble) are passed as children.
 */
export function FileChipStrip({
  children,
  align = 'start',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const count = Children.count(children)
  if (count === 0) return null
  const multiple = count > 1
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        align === 'end' ? 'justify-end' : 'justify-start',
        // 2+ chips scroll horizontally instead of wrapping into a tall stack.
        multiple && 'overflow-x-auto scrollbar-thin',
        className,
      )}
    >
      {children}
    </div>
  )
}
