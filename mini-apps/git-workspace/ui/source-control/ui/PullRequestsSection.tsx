import { useMemo, useState } from 'react'
import {
  ExternalLink,
  FileDiff,
  GitBranch,
  GitPullRequest,
  Link2,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { usePrerequisiteRecovery } from '@localixai/mini-app-sdk/ui/prerequisite-recovery'
import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import { Chip } from '@localixai/kit/chip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { WorkbenchListRow } from '@localixai/kit/workbench-list-row'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type {
  ForgeCheckRollup,
  ForgePullRequest,
  ForgeStatus,
} from '../../../backend/source-control/forge/contracts'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { StatusDot } from '@localixai/kit/status-dot'
import { platformCapabilities } from '@localixai/kit/platform'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { BulkAction } from './sourceControlParts'

/** CI rollup → StatusDot tone class + accessible label. `none` renders no dot. */
const CHECK_TONE: Record<
  Exclude<ForgeCheckRollup, 'none'>,
  { className: string; label: string }
> = {
  passing: { className: 'bg-status-success', label: 'Checks passing' },
  failing: { className: 'bg-status-error', label: 'Checks failing' },
  pending: { className: 'bg-status-warning', label: 'Checks pending' },
}

function PullRequestRow({
  pr,
  isCurrent,
  onOpenDiff,
}: {
  pr: ForgePullRequest
  isCurrent: boolean
  onOpenDiff: (pr: ForgePullRequest) => Promise<void>
}) {
  const tone = pr.checks === 'none' ? null : CHECK_TONE[pr.checks]
  const [loading, setLoading] = useState(false)
  const openDiff = async () => {
    if (loading) return
    setLoading(true)
    try {
      await onOpenDiff(pr)
    } finally {
      setLoading(false)
    }
  }
  // Right-click reaches the two things the row does — the browser handoff its primary click makes,
  // and the in-app diff its hover-only sibling button makes — plus the two copies a person reaches
  // for constantly and had to retype: the PR link and the branch it comes from.
  const menu: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open on GitHub',
      icon: ExternalLink,
      onSelect: () => platformCapabilities().external.open(pr.url),
    },
    {
      id: 'diff',
      label: 'View diff',
      icon: FileDiff,
      disabled: loading,
      onSelect: () => void openDiff(),
    },
    { separator: true },
    {
      id: 'copy-url',
      label: 'Copy link',
      icon: Link2,
      onSelect: () => void copyText(pr.url, 'Pull request link'),
    },
    {
      id: 'copy-branch',
      label: 'Copy branch name',
      icon: GitBranch,
      hint: pr.headRefName,
      onSelect: () => void copyText(pr.headRefName, 'Branch name'),
    },
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* The shared 28px list-row frame, like branches and stashes: this row used to be sized
            by its content (~24px), so the PR list sat on a different rhythm from its neighbours.
            The current branch's PR is `active`, the one selected treatment every row shares. */}
        <WorkbenchListRow
          density="dense"
          active={isCurrent}
          className="group/pr min-w-0 gap-1.5 rounded-none px-2"
          title={`#${pr.number} ${pr.title}${pr.author ? ` — @${pr.author}` : ''}`}
        >
          {/* Non-interactive row container; the primary open action is a dedicated
          focusable button so any siblings stay valid in the a11y tree. */}
          <button
            type="button"
            onClick={() => platformCapabilities().external.open(pr.url)}
            className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left outline-none focus-ring"
          >
            <GitPullRequest
              className={cn('size-4 shrink-0', isCurrent ? 'text-status-info' : 'text-text-faint')}
            />
            <span className="shrink-0 text-text-faint tabular-nums">#{pr.number}</span>
            <span className="min-w-0 truncate">{pr.title}</span>
            {pr.isDraft && (
              <Chip size="dense" className="shrink-0 uppercase tracking-wide">
                Draft
              </Chip>
            )}
          </button>
          {/* `min-w-0` + a capped name: a `shrink-0` wrapper let a long branch name squeeze
              the PR title to nothing, because its `truncate` could never engage. */}
          <span className="flex min-w-0 max-w-[45%] items-center gap-1.5">
            {/* Sibling action: view the PR's diff in-app (primary click still opens the browser). */}
            <BulkAction
              title="View diff"
              aria-label={`View diff for pull request #${pr.number}`}
              onClick={() => void openDiff()}
              disabled={loading}
              spinning={loading}
              className="lx-hover-actions opacity-0 transition-opacity focus-visible:opacity-100 group-hover/pr:opacity-100 group-focus-within/pr:opacity-100 disabled:opacity-100"
            >
              <FileDiff className="size-3.5" />
            </BulkAction>
            <span
              className="min-w-0 max-w-32 truncate text-2xs text-text-faint"
              title={pr.headRefName}
            >
              {pr.headRefName}
            </span>
            {tone && <StatusDot className={tone.className} label={tone.label} />}
          </span>
        </WorkbenchListRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export interface PullRequestsSectionProps {
  status: ForgeStatus | null
  prs: ForgePullRequest[]
  /** Branch currently checked out — its PR is pinned first + tinted. */
  currentBranch: string | null
  refreshing: boolean
  onReload: () => void
  onCreatePr: () => void
  /** Open a PR's unified diff in the inspector (async so the row can show a spinner). */
  onOpenDiff: (pr: ForgePullRequest) => Promise<void>
  /** The last list read failed; the previous list (if any) is still shown beneath it. */
  error?: string | null
}

/** The `gh` the section needs, in the shared prerequisite shape — Install / Sign in come from it. */
function ghPrerequisite(status: ForgeStatus | null): Prerequisite | null {
  if (!status) return null
  if (!status.installed) {
    return status.githubRemote
      ? { id: 'gh', name: 'GitHub CLI', state: 'missing', installUrl: 'https://cli.github.com/' }
      : null
  }
  return status.authed
    ? null
    : { id: 'gh', name: 'GitHub CLI', state: 'signed-out', command: 'gh auth login' }
}

/**
 * Collapsible GitHub "Pull Requests" section. Never nags a non-GitHub repo: without `gh` it
 * appears only when git's own remotes point at GitHub, with ONE quiet row offering to install the
 * CLI (it used to vanish, so a GitHub repo simply had no PR section and no reason given). If gh is
 * present but not signed in it shows ONE quiet row whose Sign in pastes `gh auth login` into the
 * chat's terminal; when signed in on a GitHub repo it lists open PRs (the current branch's PR pinned
 * first + tinted), each row opening the PR in the browser, with header actions to create a PR
 * (`gh pr create --web`) and refresh.
 */
export function PullRequestsSection({
  status,
  prs,
  currentBranch,
  refreshing,
  onReload,
  onCreatePr,
  onOpenDiff,
  error,
}: PullRequestsSectionProps) {
  const ready = !!status?.installed && !!status.authed && !!status.hasRemote
  const gh = ghPrerequisite(status)
  const ghRecovery = usePrerequisiteRecovery(gh)

  const ordered = useMemo(() => {
    if (!currentBranch) return prs
    // Stable pin: the current branch's PR floats to the top, order otherwise kept.
    const pinned = prs.filter((p) => p.headRefName === currentBranch)
    if (pinned.length === 0) return prs
    const rest = prs.filter((p) => p.headRefName !== currentBranch)
    return [...pinned, ...rest]
  }, [prs, currentBranch])

  // gh absent on a non-GitHub repo, or present+authed but no GitHub remote → render nothing.
  if (!status) return null
  if (!status.installed && !gh) return null
  if (status.installed && status.authed && !status.hasRemote) return null

  const actions = ready ? (
    <>
      {/* Clicks never toggle the section — CollapsibleSection's actions slot stops propagation. */}
      <BulkAction title="Create pull request" aria-label="Create pull request" onClick={onCreatePr}>
        <Plus className="size-3.5" />
      </BulkAction>
      <BulkAction
        title="Refresh pull requests"
        aria-label="Refresh pull requests"
        onClick={onReload}
        spinning={refreshing}
      >
        <RefreshCw className="size-3.5" />
      </BulkAction>
    </>
  ) : undefined

  return (
    <CollapsibleSection
      title="Pull Requests"
      count={ready ? ordered.length : undefined}
      actions={actions}
      defaultOpen={false}
    >
      {/* A failed read used to vanish into an empty list, which reads as "no open PRs". */}
      {ready && error && (
        <div
          role="status"
          className="flex items-center gap-1.5 px-2 py-1.5 text-2xs text-status-warning"
          title={error}
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">Could not load pull requests — {error}</span>
        </div>
      )}
      {gh ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 text-2xs text-text-faint">
          <span>
            {gh.state === 'missing' ? (
              'Install the GitHub CLI to see pull requests.'
            ) : (
              <>
                Sign in with the GitHub CLI (<code className="text-text-soft">gh auth login</code>)
                to see pull requests.
              </>
            )}
          </span>
          {ghRecovery && (
            <button
              type="button"
              onClick={() => void ghRecovery.run()}
              className="text-text-soft underline-offset-2 outline-none hover:text-foreground hover:underline focus-ring"
            >
              {ghRecovery.label}
            </button>
          )}
        </div>
      ) : ordered.length === 0 ? (
        <button
          type="button"
          onClick={onCreatePr}
          className="flex w-full items-center gap-1.5 px-2 py-2 text-left text-2xs text-text-faint outline-none transition-colors hover:text-text-soft focus-ring"
        >
          <Plus className="size-3.5" /> No open pull requests — create one for this branch.
        </button>
      ) : (
        ordered.map((pr) => (
          <PullRequestRow
            key={pr.number}
            pr={pr}
            isCurrent={pr.headRefName === currentBranch}
            onOpenDiff={onOpenDiff}
          />
        ))
      )}
    </CollapsibleSection>
  )
}
