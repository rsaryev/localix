import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui'

import { GIT_WORKSPACE_KIND } from './workItemKinds'

/**
 * Open (or focus) the Git workspace tab.
 *
 * Seven call sites used to spell the request out by hand, and four of them still named the
 * pre-namespace kind `'git-workspace'` — a kind the host no longer has a component for, so the
 * chip and every toast action opened an empty tab. One function means the kind, the id and the
 * title can only ever be the ones the mini app actually registered.
 *
 * The tab belongs to a chat (`sessionId`): a repository is a chat's working directory, and the tab
 * used to be app-level and follow whichever chat was in front — so a Git tab opened from one chat's
 * branch pill showed, staged and committed in another chat's tree after a switch.
 */
export function openGitWorkspace(sessionId: string): void {
  miniAppWorkspace.openWorkItem({
    workKind: GIT_WORKSPACE_KIND,
    id: GIT_WORKSPACE_KIND,
    title: 'Git',
    scope: sessionId,
  })
}
