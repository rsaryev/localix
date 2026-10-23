import { ArrowDown, ArrowUp, ClipboardCopy, GitBranch, RefreshCw } from 'lucide-react'
import type { StatusItemState, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace, runMiniAppAction, statusMenuList } from '@localixai/mini-app-sdk/ui'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'

import { useSessionGitField, useSourceControlStore } from '../source-control/model/store'
import { useBranchSwitcher } from '../source-control/ui/useBranchSwitcher'
import { openGitWorkspace } from '../openGitWorkspace'
import { GIT_WORKSPACE_KIND } from '../workItemKinds'

/**
 * The two places Git speaks from, declared rather than drawn.
 *
 * This replaces a hand-written titlebar button that had drifted from the host recipe on every
 * axis that matters — its own height, no focus ring, no pressed feedback — while sitting between
 * two host buttons that had all three. Nothing here decides how anything looks: the mini app says
 * what is true about the repository and the host renders it the way it renders its own.
 */

/**
 * The branch, how far it has diverged, and everything you would otherwise open a panel to do.
 *
 * Registered for BOTH the titlebar and the composer row: one description of what Git currently is,
 * placed twice by the host. Those were two hand-written components before, and they had already
 * disagreed — one drew `↑2↓1` with lucide arrows, the other with its own markup. The right-click
 * menu is new; neither of them had one.
 */
export function useGitBranchStatusItem(sessionId: string | null): StatusItemState | null {
  const status = useSessionGitField(sessionId, 'status')
  const workspace = useMiniAppWorkspace()
  const { list, onPick } = useBranchSwitcher(sessionId)
  const fetch = useSourceControlStore((s) => s.fetch)
  const pull = useSourceControlStore((s) => s.pull)
  const push = useSourceControlStore((s) => s.push)

  // Not a repository → no control at all. An empty button that does nothing is worse than the
  // absence it is trying to represent.
  if (!status?.isRepo || !sessionId) return null

  const focusedId = workspace.focusedId
  const active = focusedId ? workspace.items[focusedId]?.kind === GIT_WORKSPACE_KIND : false
  const branch = status.detached ? 'detached' : (status.branch ?? '')
  const { ahead, behind } = status

  // The branch you are ON leads the list as the chosen row. Leaving it out made the submenu a list
  // of unchecked checkboxes with nothing marked — a pick whose current answer was missing. First,
  // so the row limit can never truncate it away.
  const branches = [
    ...list.filter((candidate) => candidate.name === status.branch),
    ...list.filter((candidate) => candidate.name !== status.branch),
  ]

  const menu: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open Git Workspace',
      icon: GitBranch,
      onSelect: () => openGitWorkspace(sessionId),
    },
    { separator: true },
    { header: 'Branch' },
    // No "New branch…" here on purpose: creating one needs a NAME, and a menu row has nowhere to
    // ask for it. The panel that does have an input is one row up.
    {
      id: 'switch',
      label: 'Switch branch',
      // The branch you are ON, on the trigger. Reading it used to cost opening the submenu and
      // finding the ticked row — in a menu whose whole subject is which branch this is.
      ...(branch ? { hint: branch } : {}),
      // A repository whose branch list has not loaded (or an unborn HEAD) opened onto a blank
      // panel. Saying so is the difference between an answer and a menu that looks broken.
      emptyLabel: 'No branches',
      items: statusMenuList({
        items: branches,
        // Twelve, not the default eight: this is the one list where a person is hunting for a name
        // they already know, and the overflow row cannot search.
        limit: 12,
        row: (candidate) => ({
          id: `branch:${candidate.name}`,
          label: candidate.name,
          icon: GitBranch,
          // One choice among siblings: a radio row keeps the branch glyph and ticks the current
          // one at the end. Picking the current branch is a no-op in `onPick`.
          selected: candidate.name === status.branch,
          onSelect: () => void onPick(candidate.name),
        }),
        onOverflow: () => openGitWorkspace(sessionId),
        overflowLabel: (hidden) => `${hidden} more branches…`,
      }),
    },
    {
      id: 'copy-branch',
      label: 'Copy branch name',
      icon: ClipboardCopy,
      disabled: !branch,
      onSelect: () => void copyText(branch, 'Branch name'),
    },
    { separator: true },
    { header: 'Sync' },
    // The store THROWS on failure so its callers can say what did not happen — the panel does,
    // and these rows used to drop it on the floor as `void fetch(sessionId)`. A push rejected by
    // the remote is the case that matters: the menu closed, the counter stayed, and nothing said
    // the commits were still local.
    {
      id: 'fetch',
      label: 'Fetch',
      icon: RefreshCw,
      onSelect: () => runMiniAppAction(() => fetch(sessionId), 'Could not fetch'),
    },
    {
      id: 'pull',
      label: 'Pull',
      icon: ArrowDown,
      // The count as a HINT rather than baked into the label: `Pull (3)` reads as the name of the
      // command, and the number lands in the column every other trailing value in this app uses.
      ...(behind > 0 ? { hint: String(behind) } : {}),
      disabled: behind === 0,
      onSelect: () => runMiniAppAction(() => pull(sessionId), 'Could not pull'),
    },
    {
      id: 'push',
      label: 'Push',
      icon: ArrowUp,
      ...(ahead > 0 ? { hint: String(ahead) } : {}),
      disabled: ahead === 0,
      onSelect: () => runMiniAppAction(() => push(sessionId), 'Could not push'),
    },
  ]

  return {
    label: 'Git — changes, conflicts & history',
    Icon: GitBranch,
    text: branch || undefined,
    // Divergence as METRICS, not as part of the text: the host aligns them on `tabular-nums`, so
    // a counter ticking from 9 to 10 does not shove the buttons beside it sideways.
    metrics: [
      ...(ahead > 0 ? [{ icon: ArrowUp, value: String(ahead), label: `${ahead} ahead` }] : []),
      ...(behind > 0
        ? [{ icon: ArrowDown, value: String(behind), label: `${behind} behind` }]
        : []),
    ],
    active,
    onClick: () =>
      active && focusedId
        ? miniAppWorkspace.closeWorkItems(focusedId)
        : openGitWorkspace(sessionId),
    menu,
  }
}
