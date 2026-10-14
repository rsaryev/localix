import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'

/**
 * Thin toolbar above the multi-root Changes tree: a summary of how many repos
 * carry changes + which one is the active header/commit target, and Expand-/
 * Collapse-all controls that fold every repository group at once (parity with
 * the Files sidebar's tree controls). The controls are the kit's `IconButton` —
 * the hand-rolled button here had no focus indicator and a native `title` hint.
 */
export function MultiRepoBar({
  repoCount,
  dirtyCount,
  activeName,
  canExpand,
  canCollapse,
  onExpandAll,
  onCollapseAll,
}: {
  repoCount: number
  dirtyCount: number
  activeName: string
  canExpand: boolean
  canCollapse: boolean
  onExpandAll: () => void
  onCollapseAll: () => void
}) {
  return (
    <div className="flex min-h-[var(--chrome-control-sm)] shrink-0 items-center gap-2 border-b border-border-soft px-2 text-2xs text-text-faint">
      <span className="min-w-0 truncate">
        {repoCount} repositories
        {dirtyCount > 0 && <> · {dirtyCount} with changes</>} · target{' '}
        <span className="font-medium text-text-soft">{activeName}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton
          size="xs"
          tooltip="Expand all"
          aria-label="Expand all repositories"
          disabled={!canExpand}
          onClick={onExpandAll}
        >
          <ChevronsUpDown className="size-3.5" />
        </IconButton>
        <IconButton
          size="xs"
          tooltip="Collapse all"
          aria-label="Collapse all repositories"
          disabled={!canCollapse}
          onClick={onCollapseAll}
        >
          <ChevronsDownUp className="size-3.5" />
        </IconButton>
      </span>
    </div>
  )
}
