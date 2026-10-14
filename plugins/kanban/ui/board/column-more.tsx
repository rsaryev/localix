/**
 * The tail of a column whose card count is over the render cap: says how many cards
 * are held back and reveals another page of them.
 *
 * Deliberately NOT a `[data-task-card]` element — the drop-index scan counts those,
 * and this row is not a card you can drop next to.
 */
export function ColumnMore({
  hidden,
  columnTitle,
  onShowMore,
}: {
  hidden: number
  columnTitle: string
  onShowMore: () => void
}) {
  return (
    <button
      type="button"
      onClick={onShowMore}
      aria-label={`Show more cards in ${columnTitle}`}
      className="mt-0.5 shrink-0 rounded-md border border-dashed border-border-soft px-2 py-1.5 text-2xs text-text-faint outline-none transition-colors hover:border-border hover:text-foreground focus-ring"
    >
      Show {hidden} more
    </button>
  )
}
