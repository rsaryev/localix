import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { useLatestRef } from '@/shared/lib/useLatestRef'

import { backendClient } from '@/shared/api/client'
import { useChatStore } from '@/entities/chat/model/store'
import { useForkSession } from '@/entities/chat/model/useForkSession'
import type { SessionRuntime, AgentOptions } from '@/entities/chat/model/agent-runtime'
import { findSessionInState } from '@/entities/chat/model/findSession'
import { applyServerSession } from '@/entities/chat/model/sessionSync'

export interface MessageActionsDeps {
  activeSessionId: string | null
  activeSessionIsReadOnly: boolean
  /**
   * Navigate INTO a session through the router (URL-as-source-of-truth). Forking
   * and opening a thread create a NEW session and dive into it — they MUST go
   * through the URL, not a store-only `selectSession`. A store-only switch leaves
   * the URL on the parent, so the parent stays the active route: clicking "back
   * to parent" then navigates to the URL it's already on (a no-op) and you're
   * stuck in the child until a reload. Carry the child's project so the URL→store
   * sync doesn't drop into the project-less scope.
   */
  goToSession: (id: string, opts?: { project?: string }) => void
  reloadWorkspace: () => void
  setPrompt: Dispatch<SetStateAction<string>>
  agentRuntime: SessionRuntime
  agentOpts: AgentOptions
}

export interface MessageActions {
  /** Duplicate the session (optionally up to a message) and navigate to the copy. */
  forkSession: (messageId?: string) => void
  regenerate: () => void
  onRollback: (messageId: string) => void
  onSwitchBranch: (messageId: string, branchIndex: number) => void
  onEdit: (messageId: string, content: string) => void
  /** Open (or reopen) the side-conversation thread anchored to a message and dive in. */
  onOpenThread: (messageId: string) => void
}

/**
 * Message-level actions for the active session: fork, regenerate, rollback,
 * branch switch, and edit. Each is a thin backendClient/agentRuntime call;
 * read-only sessions (subagent/job) no-op. Extracted from ChatSurface so the
 * widget stays an orchestrator.
 */
export function useMessageActions({
  activeSessionId,
  activeSessionIsReadOnly,
  goToSession,
  reloadWorkspace,
  setPrompt,
  agentRuntime,
  agentOpts,
}: MessageActionsDeps): MessageActions {
  const forkSession = useForkSession(activeSessionId, goToSession)

  const regenerate = useCallback(
    () => void agentRuntime.regenerate(agentOpts),
    [agentRuntime, agentOpts],
  )

  // Every message card receives this, so its identity is part of each card's memo. Bound to
  // `reloadWorkspace`/`setPrompt` it changed on every streamed frame and re-rendered every visible
  // card, not only the one being written; it runs on a click, so it reads them at call time.
  const rollbackDeps = useLatestRef({ reloadWorkspace, setPrompt })
  const onRollback = useCallback(
    (messageId: string) => {
      if (activeSessionIsReadOnly) return
      if (!activeSessionId) return
      void backendClient
        .rollback(activeSessionId, messageId)
        .then((result) => {
          rollbackDeps.current.setPrompt(result.restoredPrompt)
          rollbackDeps.current.reloadWorkspace()
        })
        .catch((e: unknown) =>
          toast.error('Could not rewind this conversation', {
            description: errorMessage(e, '') || undefined,
          }),
        )
    },
    [activeSessionIsReadOnly, activeSessionId, rollbackDeps],
  )

  const onSwitchBranch = useCallback(
    (messageId: string, branchIndex: number) => {
      if (activeSessionIsReadOnly) return
      if (!activeSessionId) return
      void backendClient
        .switchBranch(activeSessionId, messageId, branchIndex)
        .then((session) => {
          applyServerSession(session)
        })
        .catch((e: unknown) =>
          toast.error('Could not switch branch', {
            description: errorMessage(e, '') || undefined,
          }),
        )
    },
    [activeSessionIsReadOnly, activeSessionId],
  )

  const onEdit = useCallback(
    (messageId: string, content: string) => {
      if (activeSessionIsReadOnly) return
      if (!activeSessionId) return
      // Paint the edit instantly (rewritten row + dropped tail + skeleton) so
      // confirm feels like a send, not a round-trip — the branch echoes then
      // claim/settle these under the normal optimistic rules.
      const store = useChatStore.getState()
      store._beginOptimisticEdit(activeSessionId, messageId, content)
      store._setSessionRunning(activeSessionId, true)
      // Forks a new branch from the edited message, then the run streams in via SSE.
      // Authoritatively re-sync the branch on success (like onRollback/onSwitchBranch):
      // editMessage publishes incremental message.removed events for the OLD branch,
      // but a late message.updated for an in-flight/removed message re-appends it
      // (applyStreamEvent appends unknown ids), leaving the stale branch overlaid in
      // the UI until a manual reload. Reloading the workspace drops the old branch
      // deterministically (hydrateWorkspace merges, so it can't wipe in-flight
      // optimistic state); the new run keeps streaming into the fetched fork.
      const projectId = findSessionInState(store, activeSessionId)?.projectId ?? null
      void backendClient
        .editMessage(activeSessionId, messageId, content, projectId)
        .then(() => reloadWorkspace())
        .catch((e: unknown) => {
          // The optimistic branch never happened — drop the placeholders and
          // restore the authoritative transcript.
          const s = useChatStore.getState()
          s._dropOptimistic(activeSessionId)
          s._setSessionRunning(activeSessionId, false)
          void backendClient
            .getSession(activeSessionId)
            .then((session) => applyServerSession(session))
            .catch(() => {})
          toast.error('Could not edit this message', {
            description: errorMessage(e, '') || undefined,
          })
        })
    },
    [activeSessionIsReadOnly, activeSessionId, reloadWorkspace],
  )

  const onOpenThread = useCallback(
    (messageId: string) => {
      if (!activeSessionId) return
      void backendClient
        .openMessageThread(activeSessionId, messageId)
        .then((session) => {
          applyServerSession(session)
          goToSession(session.id, { project: session.projectId ?? null })
        })
        .catch((e: unknown) =>
          toast.error('Could not open the thread', {
            description: errorMessage(e, '') || undefined,
          }),
        )
    },
    [activeSessionId, goToSession],
  )

  return { forkSession, regenerate, onRollback, onSwitchBranch, onEdit, onOpenThread }
}
