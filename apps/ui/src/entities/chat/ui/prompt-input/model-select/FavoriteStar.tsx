import { Star } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

interface FavoriteStarProps {
  favorited: boolean
  onToggle: () => void
  /** Extra classes — used to keep the star hidden until row hover when not favorited. */
  className?: string
}

/**
 * Per-row pin toggle in the model picker. A filled star when favorited; an empty
 * outline otherwise. Stops row selection so clicking the star only pins/unpins.
 */
export function FavoriteStar({ favorited, onToggle, className }: FavoriteStarProps) {
  return (
    <button
      type="button"
      data-slot="model-favorite-toggle"
      aria-pressed={favorited}
      title={favorited ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-soft outline-none transition-colors hover:bg-surface-hover focus-ring',
        favorited ? 'text-status-warning hover:text-status-warning' : 'hover:text-foreground',
        className,
      )}
    >
      <Star className={cn('size-3.5', favorited && 'fill-current')} />
    </button>
  )
}
