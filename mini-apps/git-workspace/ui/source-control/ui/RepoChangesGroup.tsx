import {
  ChevronRight,
  GitBranch,
  Check,
  Plus,
  Minus,
  ArrowUp,
  ArrowDown,
  FileDiff,
} from 'lucide-react'
import type { RepoFileChange, RepoWithStatus } from '../../../backend/source-control/contracts'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Chip } from '@localixai/kit/chip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { repoGroupMenu } from './repoGroupMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { memo, useCallback } from 'react'
import type { ChangeActions } from '../model/changeActions'
import { ChangesTree } from './changes-tree/ChangesTree'
import { BulkAction } from './sourceControlParts'
import { useChangeGroups } from '../model/changeGroups'

/**
 * What a repo group does, keyed by the repo it is asked about.
 *
 * Passed as ONE stable object to every group instead of per-repo closures: those were rebuilt for
 * every repo on every render of the panel, which defeated `memo` on each group and each tree row.
 */
export interface RepoGroupHandlers {
  onToggle: (repo: RepoWithStatus) => void
  /** Make this repo the active one (header/commit/log target). */
  onFocus: (repoRoot: string) => void
  onStageAll: (paths: string[], repoRoot: string) => void
  onUnstageAll: (paths: string[], repoRoot: string) => void
  onOpen: (file: RepoFileChange, staged: boolean, repoRoot: string) => void
  /** Open the repo's full working-tree diff in a single multi-file view. */
  onOpenAllDiff: (repoRoot: string) => void
}

/**
 * One repository's change group in the multi-root Source Control view — a
 * clickable header (name + branch + ahead/behind + change count) over its own
 * merge/staged/unstaged trees. Clicking the row FOCUSES the repo (makes it active), so
 * the header/commit box/commit log all follow it; the chevron expands/collapses.
 * Expand/collapse is CONTROLLED by the parent so an Expand-/Collapse-all control
 * can drive every group at once. File actions are already scoped to this repo by
 * the caller.
 */
export const RepoChangesGroup = memo(function RepoChangesGroup({
  repo,
  active,
  open,
  selectedPath,
  actions,
  handlers,
}: {
  repo: RepoWithStatus
  active: boolean
  /** Whether the group's body is expanded (controlled by the parent). */
  open: boolean
  selectedPath: string | null
  /** File/dir stage-unstage-discard, already scoped to this repo. */
  actions: ChangeActions
  /** Repo-keyed handlers, ONE object for every group — see {@link RepoGroupHandlers}. */
  handlers: RepoGroupHandlers
}) {
  const files = repo.status.files
  const { conflicts, staged, changed } = useChangeGroups(files)
  const { branch, ahead, behind, detached } = repo.status
  const clean = files.length === 0
  const root = repo.root
  const { onToggle: toggleRepo, onFocus: focusRepo, onOpen: openIn } = handlers
  const onToggle = () => toggleRepo(repo)
  const onFocus = () => focusRepo(root)
  const onOpenAllDiff = () => handlers.onOpenAllDiff(root)
  const onStageAll = (paths: string[]) => handlers.onStageAll(paths, root)
  const onUnstageAll = (paths: string[]) => handlers.onUnstageAll(paths, root)
  // The one handler that reaches the memoized trees, so the one that must keep its identity.
  const onOpen = useCallback(
    (file: RepoFileChange, isStaged: boolean) => openIn(file, isStaged, root),
    [openIn, root],
  )
  const menu = repoGroupMenu(repo, changed, staged, { onOpenAllDiff, onStageAll, onUnstageAll })

  return (
    <div className={cn('border-b border-border-soft', active && !clean && 'bg-surface-active/20')}>
      {/* Repo header — chevron toggles expand/collapse; the row focuses the repo. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => {
              onFocus()
              onToggle()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onFocus()
                onToggle()
              }
            }}
            title={repo.root}
            className={cn(
              'group/repo flex w-full cursor-pointer select-none items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-surface-hover/60',
              clean && 'text-text-faint',
            )}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-text-faint transition-transform',
                open && 'rotate-90',
                clean && 'opacity-50',
              )}
            />
            <GitBranch
              // `--accent-foreground`, not `--accent`: `--accent` is a FILL token — a 6% foreground
              // veil under glass — so the ACTIVE repo's glyph was fainter than the inactive one.
              className={cn(
                'size-3.5 shrink-0',
                active ? 'text-accent-foreground' : 'text-text-faint',
              )}
            />
            <span
              className={cn(
                'truncate text-xs text-foreground',
                active && 'font-medium',
                clean && 'text-text-soft',
              )}
            >
              {repo.name}
            </span>
            {branch && (
              // Shrinkable (not shrink-0) so a long repo + branch name truncates rather
              // than forcing the row wider than the pane (an unexpected horizontal scroll).
              <span className="min-w-0 truncate text-2xs text-text-faint">
                {detached ? 'detached' : branch}
              </span>
            )}
            {!clean && (
              // Per-repo actions live on the repo row (not the global header) so each
              // repo's Open-full-diff target is unambiguous. Hover-revealed; stop
              // propagation so they don't focus/toggle the group.
              <span
                role="presentation"
                className="lx-hover-actions ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/repo:opacity-100 focus-within:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BulkAction onClick={() => onOpenAllDiff()} aria-label="Open full diff">
                      <FileDiff className="size-3.5" />
                    </BulkAction>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open the full working-tree diff</TooltipContent>
                </Tooltip>
              </span>
            )}
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 text-2xs tabular-nums text-text-faint',
                clean && 'ml-auto',
              )}
            >
              {ahead > 0 && (
                <span className="flex items-center" title={`${ahead} ahead`}>
                  <ArrowUp className="size-3" />
                  {ahead}
                </span>
              )}
              {behind > 0 && (
                <span className="flex items-center" title={`${behind} behind`}>
                  <ArrowDown className="size-3" />
                  {behind}
                </span>
              )}
              {clean ? (
                <Check className="size-3 text-status-success/70" aria-label="Clean" />
              ) : (
                <Chip tone="active" size="dense" className="font-medium">
                  {files.length}
                </Chip>
              )}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <MenuEntries entries={menu} family="context" />
        </ContextMenuContent>
      </ContextMenu>

      {open && clean && (
        <div className="flex items-center gap-1.5 px-2 py-1 pl-7 text-2xs text-text-faint">
          <Check className="size-3 shrink-0 text-status-success/70" /> No changes
        </div>
      )}

      {open && !clean && (
        <div className="pb-1">
          {conflicts.length > 0 && (
            <>
              <SubLabel label="Merge Changes" count={conflicts.length} />
              <ChangesTree
                files={conflicts}
                group="conflict"
                selectedPath={selectedPath}
                actions={actions}
                onOpen={onOpen}
              />
            </>
          )}
          {staged.length > 0 && (
            <>
              <SubLabel
                label="Staged"
                count={staged.length}
                action={
                  <BulkAction
                    title="Unstage all"
                    onClick={() => onUnstageAll(staged.map((f) => f.path))}
                  >
                    <Minus className="size-3.5" />
                  </BulkAction>
                }
              />
              <ChangesTree
                files={staged}
                group="staged"
                selectedPath={selectedPath}
                actions={actions}
                onOpen={onOpen}
              />
            </>
          )}
          {changed.length > 0 && (
            <>
              <SubLabel
                label="Changes"
                count={changed.length}
                action={
                  <BulkAction
                    title="Stage all"
                    onClick={() => onStageAll(changed.map((f) => f.path))}
                  >
                    <Plus className="size-3.5" />
                  </BulkAction>
                }
              />
              <ChangesTree
                files={changed}
                group="unstaged"
                selectedPath={selectedPath}
                actions={actions}
                onOpen={onOpen}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
})

/** A tiny staged/changes sub-heading inside a repo group, with a bulk action. */
function SubLabel({
  label,
  count,
  action,
}: {
  label: string
  count: number
  action?: React.ReactNode
}) {
  return (
    <div className="group/sub flex items-center gap-1.5 px-2 py-0.5 pl-7">
      <span className="text-2xs font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </span>
      <Chip tone="active" size="dense">
        {count}
      </Chip>
      {action && (
        <span
          role="presentation"
          className="lx-hover-actions ml-auto flex items-center opacity-0 transition-opacity group-hover/sub:opacity-100 group-focus-within/sub:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {action}
        </span>
      )}
    </div>
  )
}
