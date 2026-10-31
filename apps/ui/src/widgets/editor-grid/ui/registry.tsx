import { createElement, lazy, memo, Suspense, useCallback, useEffect } from 'react'
import type { WorkItem } from '@/shared/lib/workItem'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { isCoreWorkItemKind, sessionOfScope } from '@/entities/workspace-grid/model'
import { publishLiveTabMessageContext } from '@/entities/workspace-grid/model/liveTabMessageContext'
import { useChatStore } from '@/entities/chat/model/store'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import { chatSurface } from '@/shared/ui/chatSurfaceSlot'
import { FileWorkItemBody } from './FileWorkItemBody'
import { MiniAppWorkItemBody } from './MiniAppWorkItemBody'
import { backendClient } from '@/shared/api/client'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkItemVisibilityProvider } from '@localixai/mini-app-sdk/ui/visibility'
import { WorkItemFocusProvider } from '@localixai/kit/work-item-focus'
import { lazyNamed } from '@/shared/lib/lazyNamed'

const StatsPanel = lazy(() => import('./StatsPanel').then((m) => ({ default: m.StatsPanel })))
const GlobalSearchTab = lazy(() =>
  import('@/features/search/ui/GlobalSearchTab').then((m) => ({ default: m.GlobalSearchTab })),
)
const TerminalPane = lazy(() =>
  import('@/features/terminal/ui/TerminalPane').then((m) => ({ default: m.TerminalPane })),
)
const DiffWorkItemBody = lazyNamed(() => import('./DiffWorkItemBody'), 'DiffWorkItemBody')
// The live change view pulls Monaco — keep it out of the boot chunk (the code editor's own tab
// is `FileWorkItemBody`'s).
const LiveFileChangeTab = lazy(() =>
  import('@/features/inspector/ui/LiveFileChangeTab').then((m) => ({
    default: m.LiveFileChangeTab,
  })),
)
// Remaining heavy panel bodies — none is on the first-paint (chat) path; all render
// under the WorkItemBody Suspense boundary below.
const BrowserWorkspace = lazy(() =>
  import('@/features/inspector/ui/BrowserWorkspace').then((m) => ({ default: m.BrowserWorkspace })),
)
const ProblemsTab = lazy(() =>
  import('@/features/inspector/ui/ProblemsTab').then((m) => ({ default: m.ProblemsTab })),
)
const SettingsPanel = lazy(() =>
  import('@/features/settings/ui/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
)
const TranscriptTab = lazy(() =>
  import('@/entities/chat/ui/TranscriptTab').then((m) => ({ default: m.TranscriptTab })),
)

const MessageReplayTab = lazy(() =>
  import('@/features/inspector/ui/MessageReplayTab').then((m) => ({ default: m.MessageReplayTab })),
)
const BridgedMiniAppView = lazy(() =>
  import('@/features/inspector/ui/BridgedMiniAppView').then((m) => ({
    default: m.BridgedMiniAppView,
  })),
)

function p<T = unknown>(item: WorkItem, key: string): T | undefined {
  return item.payload?.[key] as T | undefined
}

export interface WorkItemBodyProps {
  item: WorkItem
  /** The group's selected body. It can be visible in a side-by-side group without
   *  being the globally focused editor. */
  visible: boolean
  /** The focused group's active chat drives the singleton side-effects. */
  focused: boolean
  resolvedTheme: ResolvedTheme
}

/** Resolve a WorkItem to its React body (mirrors the inspector TabBody switch,
 *  reading `item.payload`). Session-live kinds follow the active chat session.
 *
 *  A MEMO BOUNDARY: the group re-renders for tab-strip reasons of its own (hover,
 *  drag highlight, a tab's dirty flag) that no body cares about, and it mounts every
 *  WARM body, not just the visible one. All four props are stable — `item` is the
 *  store's own object, the rest are booleans/a theme string — so an unrelated group
 *  render bails here instead of re-rendering a chat, a terminal and an editor. */
export const WorkItemBody = memo(function WorkItemBody(props: WorkItemBodyProps) {
  const publishMessageContext = useCallback<PublishMessageContext>(
    (context) => publishLiveTabMessageContext(props.item.id, context),
    [props.item.id],
  )
  useEffect(() => () => publishLiveTabMessageContext(props.item.id, null), [props.item.id])
  // Most non-chat kinds (file/editor, terminal, table, stats, …) — plus
  // lazy subsystem-contributed kinds — are React.lazy.
  // Without a boundary here their first-open chunk import suspends up to the app
  // root and blanks the whole screen until it loads; a local fallback keeps the
  // suspension scoped to the panel. (Cached on second open → no suspension.)
  // The session the tab BELONGS to, fixed for its life — never the one on screen. Every body,
  // core or contributed, reads it from here (`useWorkItemSessionId`): a warm-hidden Problems or
  // Browser tab of chat A that followed the active chat used to show chat B's content. An
  // app-level tab belongs to none.
  return (
    <WorkItemSessionProvider sessionId={sessionOfScope(props.item.scope)}>
      <WorkItemVisibilityProvider visible={props.visible}>
        {/* `visible` is true for BOTH halves of a split; `focused` is true for at
            most one body in the whole grid. Window-singleton contributions (the
            status bar) key off the stricter one. */}
        <WorkItemFocusProvider focused={props.focused}>
          <Suspense fallback={<LoadingHint className="text-xs" />}>
            <WorkItemBodyInner {...props} publishMessageContext={publishMessageContext} />
          </Suspense>
        </WorkItemFocusProvider>
      </WorkItemVisibilityProvider>
    </WorkItemSessionProvider>
  )
})

function WorkItemBodyInner({
  item,
  visible,
  focused,
  resolvedTheme,
  publishMessageContext,
}: WorkItemBodyProps & { publishMessageContext: PublishMessageContext }) {
  // Mini-app-exclusive kinds render through their contributed Component, which a mini app rebuild
  // can replace under the open tab (see MiniAppWorkItemBody). A contributed body is not the
  // application: a mini app that threw during render used to hit the ROOT boundary and replace the
  // whole workspace. Reserved core kinds always take the built-in switch below.
  if (!isCoreWorkItemKind(item.kind))
    return (
      <MiniAppWorkItemBody
        item={item}
        visible={visible}
        focused={focused}
        resolvedTheme={resolvedTheme}
        publishMessageContext={publishMessageContext}
      />
    )
  switch (item.kind) {
    case 'chat': {
      // The surface is a registered, stable component (see `chatSurface`), not one made here.
      const surface = chatSurface()
      return surface
        ? createElement(surface, {
            sessionId: p<string>(item, 'sessionId') ?? null,
            isFocused: focused,
            isVisible: visible,
            resolvedTheme,
          })
        : null
    }
    case 'file': {
      // Every file tab is opened into a session (`resolveOpenScope`): the editor reads and writes
      // THIS chat's workspace, never the one on screen. A tab without one has nothing to show.
      const fileSession = sessionOfScope(item.scope)
      if (!fileSession) return null
      return (
        <FileWorkItemBody
          item={item}
          sessionId={fileSession}
          publishMessageContext={publishMessageContext}
        />
      )
    }
    case 'diff':
      return <DiffWorkItemBody item={item} />
    case 'preview':
      return <SessionPreview item={item} active={visible} />
    case 'mini-app-view': {
      const miniAppName = p<string>(item, 'miniAppName') ?? ''
      const projectId = p<string>(item, 'projectId') ?? ''
      const viewId = p<string>(item, 'viewId') ?? ''
      return (
        <BridgedMiniAppView
          miniAppName={miniAppName}
          projectId={projectId}
          viewName={viewId}
          title={item.title}
          fetchHtml={() => backendClient.getMiniAppViewHtml(miniAppName, viewId, { projectId })}
          publishMessageContext={publishMessageContext}
        />
      )
    }
    case 'stats':
      return <StatsPanel onOpenSession={() => {}} />
    case 'global-search':
      return (
        <GlobalSearchTab
          initialQuery={p<string>(item, 'query') ?? ''}
          initialScope={p<string>(item, 'scope') ?? undefined}
        />
      )
    case 'problems':
      return <ProblemsTab />
    case 'settings':
      return <SettingsPanelTab />
    case 'terminal': {
      // A terminal tab is always opened into its chat (`terminalTabs.ts`); its scope says which.
      const terminalSession = sessionOfScope(item.scope)
      if (!terminalSession) return null
      return (
        <TerminalPane
          key={item.id}
          paneId={item.id}
          terminalId={p<string>(item, 'terminalId') ?? ''}
          sessionId={terminalSession}
          owned={p<boolean>(item, 'owned') ?? false}
          active={focused}
        />
      )
    }
    case 'live-file-change':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return <LiveFileChangeTab change={p<any>(item, 'change')} />
    case 'transcript':
      return (
        <TranscriptTab transcriptId={p<string>(item, 'transcriptId') ?? ''} focused={focused} />
      )
    case 'message-replay':
      return <MessageReplayTab />
    // No default: every non-core kind returned through MiniAppWorkItemBody above, so the switch
    // covers the core kinds exhaustively, and a core kind added without a case fails the lint's
    // exhaustiveness check instead of rendering "Unsupported".
  }
}

// Settings opens with its Capabilities scope defaulted to the active project, so a
// user's project-scoped agents/skills are visible without a manual scope flip.
function SettingsPanelTab() {
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  return <SettingsPanel defaultScope={activeProjectId ?? ''} />
}

// The Browser is one tab per chat: it shows ITS chat's previews, whatever chat is on screen.
function SessionPreview({ item, active }: { item: WorkItem; active: boolean }) {
  const sessionId = sessionOfScope(item.scope)
  if (!sessionId) return null
  return <BrowserWorkspace sessionId={sessionId} active={active} />
}
