import { SessionSurface } from '@/shared/contrib/sessionSurfaces'
import { StatusItems } from '@/shared/contrib/statusItems'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ProjectFolderMenu } from '@/features/chat/ui/ProjectFolderMenu'
import { PermissionsChip } from './PermissionsChip'
import { useChatStore } from '@/features/chat/model/store'
import { useAddProjectFolder } from '@/features/chat/model/useAddProjectFolder'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { scopedNewConversation } from '@/features/chat/model/conversationStartStrategy'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

/**
 * Context bar above the composer input: a left-aligned row of compact pill-chips — the
 * "where am I working" header for the chat. Reuses shared primitives (Popover, TogglePill) and
 * design tokens; no bespoke surfaces. Everything beyond the project chip is CONTRIBUTED, as a
 * declared status item or through the `composer.context` surface, so the bar knows nothing about
 * what any of it means.
 */
export function ComposerContextBar({
  activeSessionId,
  autoApprovedTools,
  children,
  running = false,
}: {
  activeSessionId: string | null
  /** Tools the user granted "Always allow" for this session — shown as a revocable chip. */
  autoApprovedTools?: string[]
  /** Unified context manifest supplied by the composer that owns draft context state. */
  children?: ReactNode
  /** An agent run is in flight for this session. Handed to contributed surfaces so one that
   *  offers a directory-moving action can disable it while a run is using that directory. */
  running?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1 pb-2">
      <ProjectChip />
      {children}
      {/* CONTRIBUTED indicator pills — declared, not drawn. Same seam as the titlebar cluster and
          the status bar: a plugin says what it has (a glyph, live text, metrics, a menu) and the
          host renders it as a `ComposerChip`, so a contributed pill cannot end up a different
          height from the project chip beside it. */}
      <StatusItems placement="composer" sessionId={activeSessionId} />

      {/* The hole for a contributed pill whose affordance is a rich inline PANEL rather than a
          menu — prose no menu row could hold. Keyed by session so a switch REMOUNTS it with fresh
          local state: such a surface carries in-flight async state, and without the key React
          reuses the instance across a switch, showing the new session's pill with the old one's
          spinner. */}
      <SessionSurface
        key={activeSessionId ?? 'none'}
        surface="composer.context"
        sessionId={activeSessionId}
        context={{ running }}
      />
      <PermissionsChip sessionId={activeSessionId} tools={autoApprovedTools ?? []} />
    </div>
  )
}

/**
 * Project chip → the shared menu of all projects + "Add folder…".
 *
 * It was hand-built rows with a green check in front of a Folder, so the chosen project looked
 * unlike the chosen option of every other pick in the app. A project is ONE choice among its
 * siblings: a `selected` row keeps the project glyph in front and marks the current one at the
 * end, the same as the mode menu beside it.
 */
function ProjectChip() {
  const { projects, activeProjectId, createSession } = useChatStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      createSession: s.createSession,
    })),
  )
  const nav = useRoutedNavigation()
  const addFolder = useAddProjectFolder()

  // Picking a project from the composer chip starts a new chat in that project (the "clean slate
  // in this folder" gesture) — an untouched draft there already is one, so it is reused. Create
  // the session, then drive the scope via the URL — never mutate activeProjectId directly. A
  // failure is said out loud: a silently rejected create left the menu closed and nothing moved.
  const pick = (projectId: string) => {
    if (projectId === activeProjectId) return
    void createSession(undefined, scopedNewConversation(projectId))
      .then((session) => {
        if (session) nav.goToSession(session.id, { project: projectId })
      })
      .catch((e: unknown) =>
        toast.error('Could not start a new conversation', {
          description: errorMessage(e, '') || undefined,
        }),
      )
  }

  return (
    <ProjectFolderMenu
      projects={projects}
      activeProjectId={activeProjectId}
      onPick={pick}
      onAddFolder={() => void addFolder()}
    />
  )
}
