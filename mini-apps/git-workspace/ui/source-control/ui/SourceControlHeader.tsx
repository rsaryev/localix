import {
  RotateCw,
  ArrowUp,
  ArrowDown,
  Archive,
  DownloadCloud,
  Flame,
  FileDiff,
  MoreHorizontal,
} from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'
import type { SourceControlStatus } from '../../../backend/source-control/contracts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { BisectBanner, RebaseBanner } from './SourceControlBanners'

interface SourceControlHeaderProps {
  status: SourceControlStatus | null
  loading: boolean
  pushing: boolean
  pulling: boolean
  fetching: boolean
  /** True when there are working-tree changes that can be stashed. */
  canStash: boolean
  stashing: boolean
  /** True when the working tree has changes to nuke. */
  canNuke: boolean
  nuking: boolean
  /** Open the full working-tree diff in one multi-file view (single-root only). */
  onOpenAllDiff?: () => void
  /** A continue/abort/skip op is in flight. */
  rebaseBusy: boolean
  onRebaseContinue: () => void
  onRebaseAbort: () => void
  onRebaseSkip: () => void
  /** A bisect good/bad/skip/reset op is in flight. */
  bisectBusy: boolean
  onBisectGood: () => void
  onBisectBad: () => void
  onBisectSkip: () => void
  onBisectReset: () => void
  onPush: () => void
  onPull: () => void
  onFetch: () => void
  onStash: () => void
  onNuke: () => void
  onRefresh: () => void
}

/**
 * Source Control header: change totals, review, remote counts, and refresh.
 * Secondary actions share an overflow menu; destructive operations still confirm
 * in the parent. The branch lives in the workbench's branch switcher.
 */
export function SourceControlHeader({
  status,
  loading,
  pushing,
  pulling,
  fetching,
  canStash,
  stashing,
  canNuke,
  nuking,
  onOpenAllDiff,
  rebaseBusy,
  onRebaseContinue,
  onRebaseAbort,
  onRebaseSkip,
  bisectBusy,
  onBisectGood,
  onBisectBad,
  onBisectSkip,
  onBisectReset,
  onPush,
  onPull,
  onFetch,
  onStash,
  onNuke,
  onRefresh,
}: SourceControlHeaderProps) {
  const rebase = status?.rebase
  const bisect = status?.bisect
  const remoteBusy = pushing || pulling || fetching
  const canPush = Boolean(status?.isRepo && status.branch && !status.detached)
  const canPull = Boolean(status?.upstream)
  const publish = canPush && !status?.upstream
  // Rare operations live in an overflow menu. This leaves room for change totals and sync
  // counts in a narrow workbench pane.
  const menu: MenuEntry[] = [
    {
      id: 'fetch',
      label: 'Fetch',
      icon: DownloadCloud,
      disabled: !canPull || remoteBusy,
      onSelect: onFetch,
    },
    {
      id: 'pull',
      label: 'Pull',
      icon: ArrowDown,
      disabled: !canPull || remoteBusy,
      onSelect: onPull,
    },
    {
      id: 'push',
      label: publish ? 'Publish branch' : 'Push',
      icon: ArrowUp,
      disabled: !canPush || remoteBusy,
      onSelect: onPush,
    },
    { separator: true },
    {
      id: 'stash',
      label: 'Stash all changes',
      icon: Archive,
      disabled: !canStash || stashing || nuking,
      onSelect: onStash,
    },
    {
      id: 'discard',
      label: 'Discard all changes…',
      icon: Flame,
      danger: true,
      disabled: !canNuke || nuking || stashing,
      onSelect: onNuke,
    },
  ]

  // Kit controls, not a local class string: the row's hand-rolled buttons got their height from
  // padding (`p-1`, `py-0.5`), so they sat off the control ladder and apart from every other
  // mini app's toolbar, and each re-wrapped its own Tooltip that IconButton already carries.
  return (
    <>
      <WorkbenchToolbar density="slim" wrap aria-label="Source control actions">
        <span className="text-2xs font-semibold uppercase tracking-wide text-text-faint">
          Changes
        </span>
        {status && status.stats.files > 0 && (
          <span className="flex items-center gap-1.5 text-2xs tabular-nums">
            <span className="text-status-success">+{status.stats.insertions}</span>
            <span className="text-status-error">−{status.stats.deletions}</span>
          </span>
        )}
        {status && status.stats.files > 0 && onOpenAllDiff && (
          <IconButton
            size="xs"
            onClick={onOpenAllDiff}
            aria-label="Open full diff"
            tooltip="Open all working-tree changes"
            tooltipSide="bottom"
          >
            <FileDiff />
          </IconButton>
        )}
        <WorkbenchToolbarSection align="end" spacing="compact">
          {status && (status.behind > 0 || pulling) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={onPull}
                  disabled={remoteBusy}
                  aria-label={`Pull ${status.behind} incoming commits`}
                >
                  {pulling ? (
                    <Spinner data-icon="inline-start" className="size-3" />
                  ) : (
                    <ArrowDown data-icon="inline-start" className="size-3" />
                  )}
                  Pull {status.behind}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {`Pull ${status.behind} commit${status.behind === 1 ? '' : 's'} (fast-forward)${status.ahead > 0 ? ` · ${status.ahead} ahead` : ''}`}
              </TooltipContent>
            </Tooltip>
          )}
          {status && (status.ahead > 0 || publish || pushing) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={onPush}
                  disabled={remoteBusy || !canPush}
                  aria-label={publish ? 'Publish branch' : `Push ${status.ahead} outgoing commits`}
                >
                  {pushing ? (
                    <Spinner data-icon="inline-start" className="size-3" />
                  ) : (
                    <ArrowUp data-icon="inline-start" className="size-3" />
                  )}
                  {publish ? 'Publish' : `Push ${status.ahead}`}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {publish
                  ? 'Publish this branch to origin and set its upstream'
                  : `Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'}${status.behind > 0 ? ` · ${status.behind} behind` : ''}`}
              </TooltipContent>
            </Tooltip>
          )}
          <IconButton
            size="xs"
            aria-label="Refresh"
            tooltip="Refresh"
            tooltipSide="bottom"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? <Spinner className="size-3.5" /> : <RotateCw className="size-3.5" />}
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="xs"
                aria-label="More source control actions"
                tooltip="More actions"
                tooltipSide="bottom"
              >
                {remoteBusy || stashing || nuking ? <Spinner /> : <MoreHorizontal />}
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <MenuEntries entries={menu} family="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>

      {rebase?.rebasing && (
        <RebaseBanner
          rebase={rebase}
          busy={rebaseBusy}
          onContinue={onRebaseContinue}
          onSkip={onRebaseSkip}
          onAbort={onRebaseAbort}
        />
      )}
      {bisect?.bisecting && (
        <BisectBanner
          bisect={bisect}
          busy={bisectBusy}
          onGood={onBisectGood}
          onBad={onBisectBad}
          onSkip={onBisectSkip}
          onReset={onBisectReset}
        />
      )}
    </>
  )
}
