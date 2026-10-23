import { useCallback, useMemo } from 'react'
import { ArrowLeft, Folder } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { useChatStore } from '@/entities/chat/model/store'
import { useActiveSessionSummary, useSessionRoster } from '@/entities/chat/model/useSessionRoster'
import { buildBreadcrumb, type BreadcrumbSegment } from '@/entities/chat/model/breadcrumb'
import { useBreadcrumbNav } from '@/entities/chat/model/useBreadcrumbNav'
import { useScopeCrumbItems } from './useScopeCrumbItems'
import { useForkSession } from '@/entities/chat/model/useForkSession'
import { useAddProjectFolder } from '@/entities/chat/model/useAddProjectFolder'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { BreadcrumbSelect } from '@localixai/kit/breadcrumb-select'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { openProjectSwitcher, openSessionSwitcher } from '@/shared/lib/chatChromeBus'
import { SessionPathSegment } from './SessionPathSegment'
import { sessionTitle } from './sessionTitle'

const Separator = () => (
  <span className="shrink-0 text-text-faint opacity-60" aria-hidden="true">
    /
  </span>
)

/**
 * Each level retains its readable width. The shared breadcrumb scrollport handles long paths,
 * keeping all ancestors reachable and the current level visible on navigation.
 */
const ANCESTOR_CRUMB = 'flex min-w-0 shrink-0 items-center'
const CURRENT_CRUMB = 'flex min-w-0 shrink-0 items-center'
/**
 * The SINGLE unified navigation breadcrumb — shares the chat header row with the
 * header action buttons. Renders the active hierarchy
 * `project › session › subsession › …`; every top segment is an inline dropdown
 * ({@link BreadcrumbSelect}) that switches at that level through the one scope API:
 *
 *   - scope       → inline dropdown of workspaces (switchProject); Search-all → ProjectSwitcher
 *   - session     → inline dropdown of scope root chats (goToSession); Search-all → SessionSwitcher
 *   - subsession  → inline fork menu (reused {@link SessionPathSegment}, goToSession)
 *
 * Navigation flows through the URL. Modal switchers remain available through each
 * dropdown's "Search all…" footer.
 *
 * `app`: the window is a plugin app (`shared/lib/pluginApp.ts`). The app's name is the root of
 * the path, not a project switch, and the conversation segment lists the app's project, which is
 * the app's history, wherever the person has gone.
 */
export function UnifiedBreadcrumb({
  app,
}: { app?: { name: string; projectId: string | null } } = {}) {
  const { activeProjectId, activeSessionId, projects } = useChatStore(
    useShallow((s) => ({
      activeProjectId: s.activeProjectId,
      activeSessionId: s.activeSessionId,
      projects: s.projects,
    })),
  )
  // List entries, not conversations: neither re-renders the bar on a streamed token.
  const allSessions = useSessionRoster()
  const activeSession = useActiveSessionSummary()
  const nav = useRoutedNavigation()

  const goToRuntimeSession = useCallback(
    (id: string) => {
      const target = allSessions.find((s) => s.id === id)
      nav.goToSession(id, target ? { project: target.projectId } : undefined)
    },
    [allSessions, nav],
  )

  const forkSession = useForkSession(activeSessionId, goToRuntimeSession)

  const segments = useMemo(
    () => buildBreadcrumb({ activeSession, allSessions, projects, activeProjectId }),
    [activeSession, allSessions, projects, activeProjectId],
  )

  const activeSessionIsReadOnly =
    activeSession?.sessionKind === 'job' || activeSession?.sessionKind === 'system'
  const isGenerating = activeSession?.isRunning ?? false

  const addFolder = useAddProjectFolder()

  const scopeItems = useScopeCrumbItems(projects, activeProjectId, nav.switchProject, addFolder)

  const scope = segments[0] as Extract<BreadcrumbSegment, { kind: 'scope' }>
  const sessionSeg = segments.find((s) => s.kind === 'session') as
    | Extract<BreadcrumbSegment, { kind: 'session' }>
    | undefined
  const { sessionItems } = useBreadcrumbNav({
    allSessions,
    activeProjectId: app ? app.projectId : activeProjectId,
    activeSessionId: sessionSeg?.session.id ?? activeSessionId,
    goToSession: goToRuntimeSession,
  })

  const subSegs = segments.filter(
    (s): s is Extract<BreadcrumbSegment, { kind: 'subsession' }> => s.kind === 'subsession',
  )

  return (
    // data-tauri-drag-region: when the breadcrumb lives in the macOS titlebar, the
    // gaps between its interactive segments must still drag the window (Tauri reads
    // the attribute on the mousedown target). Inert everywhere else.
    <div data-tauri-drag-region className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {/* Explicit parent navigation is an action adjacent to the path, not a breadcrumb level —
          and it LEADS the row, the way a back control leads an address bar. It used to trail it,
          which put an action for where you came FROM after the affordance for what comes NEXT.
          The preceding crumbs remain direct ancestor jumps; this is the one-step version. */}
      {subSegs.length > 0 && sessionSeg ? (
        <IconButton
          size="sm"
          onClick={() => goToRuntimeSession(subSegs.at(-2)?.session.id ?? sessionSeg.session.id)}
          tooltip={`Back to ${sessionTitle(subSegs.at(-2)?.session ?? sessionSeg.session)}`}
          aria-label="Back to parent session"
          className="shrink-0"
        >
          <ArrowLeft className="size-3.5" />
        </IconButton>
      ) : null}

      <WorkbenchBreadcrumb
        aria-label="Session path"
        dragRegion
        scrollable
        scrollToEndKey={`${activeSessionId ?? activeProjectId ?? 'home'}:${segments.map((segment) => (segment.kind === 'scope' ? segment.projectId : segment.session.id)).join('/')}`}
        className="flex-1"
      >
        {/* Scope segment — the active project; inline dropdown + Search-all.
            ALWAYS a single dropdown trigger (no split-click): a project is not a
            navigable destination on its own — there is no "project page" to jump to —
            so a label-click nav would be a dead end. The whole segment opens the
            workspace switcher. */}
        <li className={sessionSeg ? ANCESTOR_CRUMB : CURRENT_CRUMB}>
          {app ? (
            <span
              data-tauri-drag-region
              className="max-w-[10rem] truncate px-1.5 text-text-soft"
              aria-current={!sessionSeg ? 'page' : undefined}
            >
              {app.name}
            </span>
          ) : (
            <BreadcrumbSelect
              label={scope.label}
              icon={<Folder className="size-3.5" />}
              items={scopeItems}
              onSearchAll={openProjectSwitcher}
              searchAllLabel="Search all workspaces…"
              ariaLabel="Switch workspace"
              ariaCurrent={!sessionSeg ? 'page' : undefined}
              className={cn(
                'text-text-soft hover:text-foreground',
                // An ancestor gets a tighter cap than the leaf: on a narrow path the project name is
                // the crumb a person needs least, because it is the one thing the window as a whole
                // already tells them.
                sessionSeg ? 'max-w-[10rem]' : 'max-w-[14rem]',
              )}
            />
          )}
        </li>

        {/* Session segment — the root chat; inline dropdown + Search-all.
            Smart click: inside a subsession the label is a fast "jump to the root
            chat" (chevron = list); when this segment IS the current leaf there is
            nowhere to jump, so the whole segment opens the session list. */}
        {sessionSeg ? (
          <li className={cn(subSegs.length === 0 ? CURRENT_CRUMB : ANCESTOR_CRUMB, 'gap-1.5')}>
            <Separator />
            <BreadcrumbSelect
              label={sessionTitle(sessionSeg.session)}
              items={sessionItems}
              onSearchAll={openSessionSwitcher}
              searchAllLabel="Search all sessions…"
              ariaLabel="Switch session"
              ariaCurrent={subSegs.length === 0 ? 'page' : undefined}
              onNavigate={
                subSegs.length > 0 ? () => goToRuntimeSession(sessionSeg.session.id) : undefined
              }
              className={
                subSegs.length === 0
                  ? 'max-w-[16rem] text-sm text-foreground'
                  : 'max-w-[11rem] text-text-soft hover:text-foreground'
              }
            />
          </li>
        ) : null}

        {/* Sub-session segments (fork / thread / worker) down to the active one. */}
        {subSegs.map((seg) => (
          <li
            key={seg.session.id}
            className={cn(seg.isCurrent ? CURRENT_CRUMB : ANCESTOR_CRUMB, 'gap-1.5')}
          >
            <Separator />
            <SessionPathSegment
              session={seg.session}
              sessions={allSessions}
              isCurrent={seg.isCurrent}
              activeChildId={seg.activeChildId}
              onSelect={goToRuntimeSession}
              onFork={seg.isCurrent && !activeSessionIsReadOnly ? forkSession : undefined}
              disabled={isGenerating}
            />
          </li>
        ))}

        {/* NOTE: no git-branch segment here. The branch lives in exactly two places —
            the header Source Control quick-action (read-only status) and the composer
            BranchChip (the switcher). A third copy in the breadcrumb was pure noise. */}
      </WorkbenchBreadcrumb>
    </div>
  )
}
