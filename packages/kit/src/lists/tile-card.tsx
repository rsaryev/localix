import { memo, useId, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

export interface TileCardProps {
  /** The icon, at the size the card is for (56px in a row). */
  tile: ReactNode
  title: string
  /** One line under the name: who publishes it, or what kind it is. */
  subtitle?: ReactNode
  /** The card's one action, at the tile's right edge on the same row: a Get pill. */
  action?: ReactNode
  /** The accessible name of the whole-card button. */
  openLabel: string
  onOpen: () => void
  /** The pointer rests on it or focus reaches it: a host may start reading its page. */
  onIntent?: () => void
  className?: string
}

/**
 * A storefront row's compact tile, the lockup app stores use: the icon, the name in up to two
 * lines — wrapped at words, never cut to its first one — one quiet line under it, and its one
 * action at the right edge. Every tile is as tall as its icon plus padding, so a row is even.
 * The whole tile opens the item; the action is its own control above that. Belongs in a
 * `ShelfRow`, which sizes it.
 */
export const TileCard = memo(function TileCard({
  tile,
  title,
  subtitle,
  action,
  openLabel,
  onOpen,
  onIntent,
  className,
}: TileCardProps) {
  const subtitleId = useId()
  return (
    <div
      onPointerEnter={onIntent}
      onFocus={onIntent}
      className={cn(
        'group/tile-card relative flex h-full min-w-0 items-center gap-3 rounded-lg p-2 hover:bg-surface-hover',
        className,
      )}
    >
      <button
        type="button"
        aria-label={openLabel}
        aria-describedby={subtitle ? subtitleId : undefined}
        className="absolute inset-0 rounded-lg focus-ring"
        onClick={onOpen}
      />
      <span className="pointer-events-none shrink-0">{tile}</span>
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium break-words text-foreground">
          {title}
        </p>
        {subtitle && (
          <p id={subtitleId} className="min-w-0 truncate text-2xs text-text-soft">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="pointer-events-auto relative shrink-0">{action}</div>}
    </div>
  )
})
