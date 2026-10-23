import { lazy, Suspense, useEffect } from 'react'
import { GitBranch } from 'lucide-react'

import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import {
  parseLocalixResourceUri,
  resourceMessageBindingDraft,
  type WorkItemLike,
  type MiniAppUiHost,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { useMiniAppSessions } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { LoadingHint } from '@localixai/kit/empty-hint'
import type { LineStageMode } from '../backend/source-control/contracts'
import { DiffStagingView } from './source-control/ui/DiffStagingView'
import {
  CommitProvenanceHeader,
  type CommitProvenance,
} from './source-control/ui/CommitProvenanceHeader'
import { GitPoller } from './session/GitPoller'
import { useGitBranchStatusItem } from './session/statusItems'
import { GitFileEnhancer } from './editor/GitFileEnhancer'
import { GIT_WORKSPACE_KIND } from './workItemKinds'
import { useGitFileTreeDecorations } from './editor/useFileTreeDecorations'

const GitWorkspace = lazy(() =>
  import('./GitWorkspace').then((module) => ({ default: module.GitWorkspace })),
)

function GitWorkspaceBody({
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  // The repository of the chat this tab BELONGS to (a session kind, so the host states it). It
  // followed the focused chat once, as an app-level tab: after a switch, a Git tab opened from one
  // chat's branch pill staged and committed in another chat's working tree.
  //
  // Read through the SDK's session seam rather than the host's chat store: a mini app does not get
  // to reach into core feature state, and the seam already publishes the project needed here.
  const sessionId = useWorkItemSessionId()
  const sessions = useMiniAppSessions()
  const projectId = sessions.find((session) => session.id === sessionId)?.projectId ?? null

  // A mounted Git Workspace is itself useful agent context. Publish the working
  // status through the same lifecycle-owned tab context seam used by Trading and
  // Database: auto-linking can attach it, tab drag can reuse it, and unmount
  // removes it without leaving a stale ambient reference.
  useEffect(() => {
    if (!publishMessageContext || !projectId) return
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: localixResourceUri('git', [projectId, 'status']),
          label: 'Working tree status',
        }),
      ],
    })
    return () => publishMessageContext(null)
  }, [projectId, publishMessageContext])

  return (
    <>
      {/* The tab keeps its own chat's tree fresh while it is on screen. The `chat.background`
          poller stops when that chat's pane loses focus — which is exactly when this tab has it. */}
      <GitPoller sessionId={visible === false ? null : sessionId} />
      <Suspense fallback={<LoadingHint>Opening Git Workspace…</LoadingHint>}>
        <GitWorkspace sessionId={sessionId} />
      </Suspense>
    </>
  )
}

function InteractiveDiffSlot({ item, value }: { item: WorkItemLike; value?: unknown }) {
  const staging = value as
    | {
        sessionId?: unknown
        path?: unknown
        mode?: unknown
        repoRoot?: unknown
      }
    | undefined
  if (
    !staging ||
    typeof staging.sessionId !== 'string' ||
    typeof staging.path !== 'string' ||
    (staging.mode !== 'staged' && staging.mode !== 'unstaged')
  ) {
    return null
  }
  return (
    <DiffStagingView
      sessionId={staging.sessionId}
      path={staging.path}
      mode={staging.mode as LineStageMode}
      repoRoot={typeof staging.repoRoot === 'string' ? staging.repoRoot : undefined}
      title={item.title}
    />
  )
}

function ProvenanceSlot({ value }: { value?: unknown }) {
  if (!value || typeof value !== 'object') return null
  return <CommitProvenanceHeader provenance={value as CommitProvenance} />
}

let registered = false

/** Register the Git surface through the same open workbench seams as other bundled mini apps. */
export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  host.workItems.register({
    kind: GIT_WORKSPACE_KIND,
    Component: GitWorkspaceBody,
    Icon: GitBranch,
    restorable: true,
    // A session kind: the workspace shows ONE chat's repository, the one it was opened from.
    scope: 'session',
    placement: 'aux',
  })

  host.workItemSlots.register({
    slot: 'diff.interactive',
    Component: InteractiveDiffSlot,
  })
  // The poller follows the chat it is mounted in. It used to be the rail viewlet's app-level
  // `Mount`, which belongs to no chat and could only guess one by reading the active session.
  host.sessionSurfaces.register({
    surface: 'chat.background',
    Component: GitPoller,
  })
  host.fileEditorEnhancers.register({
    id: 'git-workspace:history',
    match: () => true,
    Component: GitFileEnhancer,
  })
  host.fileTreeDecorations.register({
    id: 'git-workspace:file-tree',
    useIndex: useGitFileTreeDecorations,
  })
  // Declared, not drawn: the host renders both of these with the same control it gives its own
  // titlebar buttons and status segments. What used to be a hand-written button here had already
  // drifted from that recipe on height, focus and press feedback.
  host.statusItems.register({
    id: 'git-workspace:branch',
    placement: 'titlebar',
    useItem: useGitBranchStatusItem,
  })
  host.workItemSlots.register({
    slot: 'diff.provenance',
    Component: ProvenanceSlot,
  })

  host.railViewlets.register({
    kind: GIT_WORKSPACE_KIND,
    // Plain `Git`, like every sibling (`Reader`, `Trading`, `Database`): a display name may not
    // be padded with the container it opens in — the rail already says it is a workspace.
    title: 'Git',
    label: 'Git — changes, conflicts & history',
    defaultArea: 'bar',
    keywords: [
      'git',
      'source control',
      'changes',
      'conflicts',
      'merge',
      'history',
      'branches',
      'review',
    ],
    Icon: GitBranch,
  })

  host.anchors.register({
    id: 'git-workspace:anchor',
    // `namespaces`, the field the contract declares — `schemes` was silently ignored, so the
    // anchor claimed nothing and a git resource had no owner to open.
    namespaces: ['git'],
    icons: {
      repo: GitBranch,
      'git-branch': GitBranch,
      'git-commit': GitBranch,
      'file-diff': GitBranch,
    },
    resolve: (uri) =>
      parseLocalixResourceUri(uri)?.provider === 'git'
        ? {
            kind: 'work-item',
            workKind: GIT_WORKSPACE_KIND,
            id: GIT_WORKSPACE_KIND,
            title: 'Git',
          }
        : null,
  })
}
