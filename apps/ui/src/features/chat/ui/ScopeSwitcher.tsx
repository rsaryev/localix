import { ChevronsUpDown, Folder } from 'lucide-react'

interface ScopeSwitcherProps {
  /** Active project name; null only while the scope is still resolving. */
  scopeName: string | null
  onOpen: () => void
}

/**
 * The chat sidebar's workspace identity — the active project, rendered as a compact,
 * tappable header that opens the scope switcher. It takes the PanelHeader title slot so the
 * panel has a SINGLE header row (the redundant static "Chats" label is gone) while keeping
 * the semantic, pixel-stable panel header height every rail section shares.
 *
 * Every scope is a project, so the label has no "Global" fallback: a name that has not
 * arrived yet shows the neutral placeholder for the one frame before it does.
 */
export function ScopeSwitcher({ scopeName, onOpen }: ScopeSwitcherProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Switch workspace"
      className="group -ml-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-sidebar-accent/50 focus-ring"
    >
      <Folder className="size-3.5 shrink-0 text-sidebar-foreground/55 transition-colors group-hover:text-sidebar-foreground/80" />
      <span className="min-w-0 truncate text-sm font-semibold leading-none text-sidebar-foreground">
        {scopeName ?? 'Workspace'}
      </span>
      <ChevronsUpDown className="size-3 shrink-0 text-sidebar-foreground/40 transition-colors group-hover:text-sidebar-foreground/65" />
    </button>
  )
}
