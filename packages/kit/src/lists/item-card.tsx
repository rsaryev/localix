import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

export interface ItemCardProps extends Omit<HTMLAttributes<HTMLLIElement>, 'title'> {
  /** The picture on the left: an icon tile at 40px. */
  tile?: ReactNode
  title: ReactNode
  /** Marks after the title: a verified badge, a version, a kind label. */
  marks?: ReactNode
  description: string
  /** Replaces the description with something that went wrong. */
  note?: string
  /** A line under the description: tags, what is inside. Its controls stay clickable. */
  footer?: ReactNode
  /** The card's own controls on the right. */
  actions?: ReactNode
  /** The accessible name of the whole-card button. */
  openLabel: string
  onOpen: () => void
}

/**
 * One item in a browsable collection (a store, a gallery of templates): tile, title with its
 * marks, one line of what it is, a footer and its actions. The whole card is one button that
 * opens the item; the footer's and the actions' controls sit above it and act on their own.
 * Belongs in a `CardGrid`, which lays cards out in one or two columns by the pane's width.
 */
export function ItemCard({
  tile,
  title,
  marks,
  description,
  note,
  footer,
  actions,
  openLabel,
  onOpen,
  className,
  ...props
}: ItemCardProps) {
  const descriptionId = useId()
  return (
    <li
      {...props}
      className={cn(
        'group/item-card relative flex min-h-16 items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover',
        className,
      )}
    >
      <button
        type="button"
        aria-label={openLabel}
        aria-describedby={descriptionId}
        className="absolute inset-0 rounded-md focus-ring"
        onClick={onOpen}
      />
      {tile}
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="max-w-full shrink-0 truncate">{title}</span>
          {marks}
        </p>
        <p
          id={descriptionId}
          className={cn('truncate text-xs', note ? 'text-status-error' : 'text-text-soft')}
          title={note ?? description}
        >
          {note ?? description}
        </p>
        {footer && (
          <div className="pointer-events-auto relative mt-1 flex w-fit max-w-full flex-wrap items-center gap-1">
            {footer}
          </div>
        )}
      </div>
      {actions && <div className="relative shrink-0">{actions}</div>}
    </li>
  )
}
