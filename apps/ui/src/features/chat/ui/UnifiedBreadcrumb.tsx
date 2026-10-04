import { useCallback, useMemo, useRef } from 'react'
import { ArrowLeft, Folder, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { useChatStore } from '@/features/chat/model/store'
import { useActiveSessionSummary, useSessionRoster } from '@/features/chat/model/useSessionRoster'
import {
  buildBreadcrumb,
  visibleSubsessionCount,
  type BreadcrumbSegment,
} from '@/features/chat/model/breadcrumb'
import { sessionAgentHandle } from '@/features/chat/model/sessionGroups'
import { useBreadcrumbNav } from '@/features/chat/model/useBreadcrumbNav'
import { useCrumbAgents } from '@/features/chat/model/useCrumbAgents'
import { useScopeCrumbItems } from './useScopeCrumbItems'
import { useForkSession } from '@/features/chat/model/useForkSession'
import { useAddProjectFolder } from '@/features/chat/model/useAddProjectFolder'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { BreadcrumbSelect } from '@localixai/kit/breadcrumb-select'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { useElementWidth } from '@localixai/kit/lib'
import { CMD, useChordHint } from '@/shared/lib/keybindings'
import {
  openProjectSwitcher,
  openSessionSwitcher,
  requestNewChat,
} from '@/shared/lib/chatChromeBus'
import { SessionPathSegment } from './SessionPathSegment'
import { SessionPathOverflow } from './SessionPathOverflow'

const Separator = () => (
  <span className="shrink-0 text-text-faint" aria-hidden="true">
    /
  </span>
)

/**
 * Which crumb gives up its width first.
 *
 * Every segment can truncate, so the question a narrow titlebar really asks is WHICH one truncates
 * — and the answer is never the level you are at. Ancestors shrink three times as fast as the
 * current segment, so `long-project-name / a-long-old-chat-title / here` degrades to
 * `long-pro… / a-lon… / here` rather than shortening all three evenly until none of them reads.
 */
const ANCESTOR_CRUMB = 'flex min-w-0 shrink-[3] items-center'
const CURRENT_CRUMB = 'flex min-w-0 shrink items-center'
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
 * dropdown's "Search all…" footer; a trailing "+" starts a new chat.
 */
export function UnifiedBreadcrumb() {
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

  const { chatAgents, jumpToAgent } = useCrumbAgents({
    allSessions,
    activeProjectId,
    goToSession: goToRuntimeSession,
  })

  const scope = segments[0] as Extract<BreadcrumbSegment, { kind: 'scope' }>
  const sessionSeg = segments.find((s) => s.kind === 'session') as
    | Extract<BreadcrumbSegment, { kind: 'session' }>
    | undefined
  // Which branch the trail is in. Taken from the ROOT chat, not the active leaf: a fork or a
  // worker belongs to the same agent as the chat it hangs under, and reading it from the leaf
  // would make the segment flicker between levels of one conversation.
  const currentAgent = sessionSeg ? sessionAgentHandle(sessionSeg.session) : undefined
  const { agentItems, sessionItems, currentAgentLabel } = useBreadcrumbNav({
    allSessions,
    activeProjectId,
    activeSessionId,
    projects,
    currentAgent,
    chatAgents,
    goToSession: goToRuntimeSession,
    startChatWith: jumpToAgent,
  })

  const subSegs = segments.filter(
    (s): s is Extract<BreadcrumbSegment, { kind: 'subsession' }> => s.kind === 'subsession',
  )

  // Collapse the oldest sub-sessions when the lineage is deeper than the width allows. Measured
  // on this row rather than the viewport: the trail's box is what it has to fit into, and the
  // titlebar's trailing action cluster moves that boundary without the window changing size.
  const pathRef = useRef<HTMLDivElement>(null)
  const pathWidth = useElementWidth(pathRef)
  const overflowCount = Math.max(0, subSegs.length - visibleSubsessionCount(pathWidth))
  const hidden = subSegs.slice(0, overflowCount).map((s) => s.session)
  const visibleSubs = subSegs.slice(overflowCount)
  const hint = useChordHint()

  return (
    // data-tauri-drag-region: when the breadcrumb lives in the macOS titlebar, the
    // gaps between its interactive segments must still drag the window (Tauri reads
    // the attribute on the mousedown target). Inert everywhere else.
    <div
      ref={pathRef}
      data-tauri-drag-region
      className="flex min-w-0 items-center gap-1.5 overflow-hidden"
    >
      {/* Explicit parent navigation is an action adjacent to the path, not a breadcrumb level —
          and it LEADS the row, the way a back control leads an address bar. It used to trail it,
          which put an action for where you came FROM after the affordance for what comes NEXT.
          The preceding crumbs remain direct ancestor jumps; this is the one-step version. */}
      {subSegs.length > 0 && sessionSeg ? (
        <IconButton
          size="sm"
          onClick={() => goToRuntimeSession(subSegs.at(-2)?.session.id ?? sessionSeg.session.id)}
          tooltip={`Back to ${subSegs.at(-2)?.session.title || sessionSeg.session.title || 'parent session'}`}
          aria-label="Back to parent session"
          className="shrink-0"
        >
          <ArrowLeft className="size-3.5" />
        </IconButton>
      ) : null}

      <WorkbenchBreadcrumb aria-label="Session path" dragRegion className="flex-1">
        {/* Scope segment — the active project; inline dropdown + Search-all.
            ALWAYS a single dropdown trigger (no split-click): a project is not a
            navigable destination on its own — there is no "project page" to jump to —
            so a label-click nav would be a dead end. The whole segment opens the
            workspace switcher. */}
        <li className={sessionSeg ? ANCESTOR_CRUMB : CURRENT_CRUMB}>
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
        </li>

        {/* Agent segment — WHICH BRANCH of the list this chat is in.
            Only when there is a chat: with nothing open there is no branch to be in, and a
            crumb that named one anyway would be a filter pretending to be a location. */}
        {currentAgent ? (
          <li className={cn(ANCESTOR_CRUMB, 'gap-1.5')}>
            <Separator />
            <BreadcrumbSelect
              label={currentAgentLabel ?? currentAgent}
              items={agentItems}
              ariaLabel="Switch agent"
              className="max-w-[9rem] text-text-soft hover:text-foreground"
            />
          </li>
        ) : null}

        {/* Session segment — the root chat; inline dropdown + Search-all.
            Smart click: inside a subsession the label is a fast "jump to the root
            chat" (chevron = list); when this segment IS the current leaf there is
            nowhere to jump, so the whole segment opens the session list. */}
        {sessionSeg ? (
          <li className={cn(subSegs.length === 0 ? CURRENT_CRUMB : ANCESTOR_CRUMB, 'gap-1.5')}>
            <Separator />
            <BreadcrumbSelect
              label={sessionSeg.session.title || 'Untitled Chat'}
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

        {/* Collapsed ancestors when the sub-session lineage is deep. */}
        {hidden.length > 0 ? (
          <li className="flex shrink-0 items-center gap-1.5">
            <Separator />
            <SessionPathOverflow sessions={hidden} onSelect={goToRuntimeSession} />
          </li>
        ) : null}

        {/* Sub-session segments (fork / thread / worker) down to the active one. */}
        {visibleSubs.map((seg) => (
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

        {/* New chat in the active scope — the END OF THE CHAIN, and part of it.
            It sat outside the trail before, past the back button, where it read as a toolbar
            button that happened to be nearby. Where you are ends with what you can start next, so
            it is the trail's last item: the tab order runs ancestors → current → new, and a
            keyboard user reaches it by continuing through the path rather than leaving it.

            `shrink-0` and no separator: it is an ACTION terminating the path, not another level,
            and the crumbs beside it give up their width first (see ANCESTOR_CRUMB) so a deep
            lineage in a narrow window can never squeeze it out of the row. */}
        <li className="flex shrink-0 items-center pl-0.5">
          <IconButton
            size="sm"
            onClick={requestNewChat}
            tooltip={hint('New chat in this scope', CMD.newChat)}
            aria-label="New chat"
          >
            <Plus className="size-4" />
          </IconButton>
        </li>
      </WorkbenchBreadcrumb>
    </div>
  )
}
