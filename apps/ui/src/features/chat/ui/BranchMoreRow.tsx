/**
 * "Show all (N)" / "Show less" — the same affordance at every level of the list.
 *
 * One component so a branch of chats and a branch of sub-sessions do not grow two slightly
 * different rows for the same idea. It takes its own indent because the thing it belongs to
 * can be at any depth.
 */
export function BranchMoreRow({
  hidden,
  showingAll,
  onToggle,
  indent = 0,
}: {
  hidden: number
  showingAll: boolean
  onToggle: () => void
  /** Left inset in px, matching the rows it sits under. */
  indent?: number
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={indent ? { paddingLeft: indent } : undefined}
      className="focus-ring flex h-7 items-center rounded-lg px-2 text-2xs font-medium text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/75"
    >
      {showingAll ? 'Show less' : `Show all (${hidden})`}
    </button>
  )
}
