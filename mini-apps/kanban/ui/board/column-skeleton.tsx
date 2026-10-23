import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Placeholder card heights, so the skeleton reads as a short list rather than a
 *  grid of identical blocks. Fixed, not random — a skeleton that reshuffles on
 *  every render is more distracting than the wait it covers. */
/** Distinct values also give each row a stable key without an index. */
const ROWS = ['h-9', 'h-12', 'h-10'] as const

/**
 * What a column shows while the board's first fetch is in flight.
 *
 * `tasks: []` used to mean both "not loaded" and "empty", so every column read
 * "No tasks" for the length of the first round-trip and then popped. kaneo covers
 * the same gap with column-and-card skeletons keyed off a missing project
 * (apps/web/src/components/kanban-board/index.tsx:187-233); ours is the same idea
 * at our card size, drawn in the board's own surface tokens.
 */
export function ColumnSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5')}
      data-testid="kanban-column-skeleton"
    >
      {ROWS.map((height) => (
        <div
          key={height}
          className={cn(
            'animate-pulse rounded-md border border-border-soft bg-foreground/5',
            height,
          )}
        />
      ))}
    </div>
  )
}
