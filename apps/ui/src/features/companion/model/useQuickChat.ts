import { useComposerAttachments } from '@/shared/lib/attachments/useComposerAttachments'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoScroll } from '@/shared/hooks/useAutoScroll'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { needsSessionResync } from '@/shared/api/applyStreamEvent'
import { useChatStore } from '@/entities/chat/model/store'
import { findSessionInState } from '@/entities/chat/model/findSession'
import { scopedNewConversation } from '@/entities/chat/model/conversationStartStrategy'
import { useSendMessage } from '@/entities/chat/model/useSendMessage'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'
import { useViewState } from '@/shared/lib/view-state/useViewState'
import { viewStateStore } from '@/shared/lib/view-state/store'
import { useComposerDraft } from '@/entities/chat/model/useComposerDraft'
import { useComposerPrefill } from '@/entities/chat/model/useComposerPrefill'
import { useSessionRuntime } from '@/entities/chat/model/agent-runtime'
import { useForkSession } from '@/entities/chat/model/useForkSession'
import { useConnections } from '@/entities/chat/ui/prompt-input/useConnections'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { sessionRoute } from '@/shared/api/contracts'
import { findCatalogModelForConnection } from '@localixai/agent/catalog'
import { reconcileAfterReconnect } from '@/entities/chat/model/reconnect-reconcile'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { isAgentUnavailable } from '@/entities/chat/model/newChatAgent'
import { isMissingSession, landIn, restoreOrLand } from './islandConversation'
import { applyServerSession } from '@/entities/chat/model/sessionSync'

export const ISLAND_SESSION_KEY = 'localix_companion_session_v1'
/** The backend view-state record that both the island and the workspace read. */
const QUICK_CHAT = { kind: 'surface', key: 'quick-chat' } as const

/**
 * One creation pipeline: `landing` reuses an untouched draft, otherwise a new chat. Quick requests
 * go to the default assistant; when that agent is withdrawn or disabled the server picks its own
 * default instead of leaving the island without a conversation.
 */
const createIn = async (projectId: string | null, landing: boolean) => {
  const store = useChatStore.getState()
  try {
    return await store.createSession(
      undefined,
      scopedNewConversation(projectId, { kind: 'default' }, landing),
    )
  } catch (error) {
    if (!isAgentUnavailable(error)) throw error
    const session = await backendClient.createSession({
      projectId,
      ...(landing ? { reuseEmptyDraft: true } : {}),
    })
    applyServerSession(session)
    return session
  }
}

/** A surface of the existing chat pipeline, not another runner or notification channel. */
export function useQuickChat(focused = true) {
  const legacy = useRef(loadString(ISLAND_SESSION_KEY))
  const selection = useViewState(QUICK_CHAT)
  const sessionId =
    selection.value && 'sessionId' in selection.value
      ? selection.value.sessionId
      : !selection.loaded
        ? (loadString(ISLAND_SESSION_KEY) ?? useChatStore.getState().activeSessionId)
        : null
  const target = useRef<string | null>(sessionId)
  useEffect(() => {
    target.current = sessionId
    if (selection.loaded) saveString(ISLAND_SESSION_KEY, sessionId)
  }, [sessionId, selection.loaded])
  const session = useChatStore((state) => (sessionId ? findSessionInState(state, sessionId) : null))
  const [error, setError] = useState<string | null>(null)
  // Landing failed: nothing to show. The island offers Retry for exactly this.
  const [startFailed, setStartFailed] = useState(false)
  // Bumped by Retry so the refresh of the current conversation runs again.
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft, draftState] = useComposerDraft(sessionId)
  const composerRef = useRef<HTMLDivElement>(null)
  const creation = useRef<Promise<
    ReturnType<typeof useChatStore.getState>['sessions'][number] | null | undefined
  > | null>(null)
  const connections = useConnections(sessionId)
  const { models } = useModelsCatalog()
  const route = session ? sessionRoute(session) : null
  const model = route?.modelId ?? ''
  const reasoningEffort = route?.reasoningEffort ?? 'low'
  const catalogModel = findCatalogModelForConnection(
    models,
    connections.connections,
    connections.activeId,
    model,
  )
  const files = useComposerAttachments(catalogModel?.inputModalities)
  const runtime = useSessionRuntime(sessionId)
  const scrolling = useAutoScroll<HTMLDivElement>(sessionId, focused)
  const selectSession = useCallback((id: string) => {
    target.current = id
    saveString(ISLAND_SESSION_KEY, id)
    viewStateStore.set(QUICK_CHAT, { sessionId: id })
  }, [])
  // A remembered conversation the server no longer has is dropped silently, everywhere.
  const forget = useCallback((id: string) => {
    if (legacy.current === id) legacy.current = null
    if (loadString(ISLAND_SESSION_KEY) === id) saveString(ISLAND_SESSION_KEY, null)
    if (target.current !== id) return
    target.current = null
    viewStateStore.set(QUICK_CHAT, { sessionId: null })
  }, [])
  const prepare = useCallback(() => {
    if (creation.current) return creation.current
    creation.current = (async () => {
      const selected = await viewStateStore.ready(QUICK_CHAT)
      let id = selected.value && 'sessionId' in selected.value ? selected.value.sessionId : null
      if (!id && selected.revision === 0) id = legacy.current
      const { session, restored } = await restoreOrLand(id, {
        find: (sessionId) => findSessionInState(useChatStore.getState(), sessionId),
        fetch: (sessionId) => backendClient.getSession(sessionId),
        land: (projectId) => createIn(projectId, true),
        forget,
      })
      if (session && restored) applyServerSession(session)
      if (session && (!restored || selected.revision === 0)) selectSession(session.id)
      setStartFailed(false)
      return session
    })()
      .catch((cause: unknown) => {
        setStartFailed(true)
        throw cause
      })
      .finally(() => {
        creation.current = null
      })
    return creation.current
  }, [selectSession, forget])
  const forkSession = useForkSession(sessionId, selectSession)
  const agentOpts = useMemo(() => ({ model, reasoningEffort }), [model, reasoningEffort])
  const send = useSendMessage({
    prompt: draft,
    setPrompt: setDraft,
    attachments: files.attachments,
    clearAttachments: files.clearAttachments,
    activeSessionId: sessionId,
    agentRuntime: runtime,
    agentOpts,
    forkSession,
    forceScrollToBottom: scrolling.forceScrollToBottom,
    goToSession: selectSession,
    createSession: prepare,
  })
  useComposerPrefill({
    composerRef,
    setPrompt: setDraft,
    addFiles: files.addFiles,
    sessionId,
    send: (text, internal) => send(text, undefined, internal),
  })
  const running = Boolean(session?.isRunning)

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    const recover = async () => {
      try {
        await reconcileAfterReconnect({
          sessionId,
          getCurrent: () => findSessionInState(useChatStore.getState(), sessionId),
          isStillTarget: () => alive && target.current === sessionId,
          fetchSession: () => backendClient.getSession(sessionId),
          applySession: (detail) => applyServerSession(detail),
        })
      } catch (cause) {
        if (!alive) return
        if (isMissingSession(cause)) forget(sessionId)
        else setError(errorMessage(cause, 'Could not refresh this conversation.'))
      }
    }
    const off = eventSocket.onSessionEvent((id, event) => {
      if (event.type === 'session.deleted' && event.sessionIds.includes(sessionId)) {
        forget(sessionId)
        return
      }
      if (id !== sessionId) return
      const current = findSessionInState(useChatStore.getState(), id)
      if (current && needsSessionResync(current, event)) void recover()
      // The same reducer/optimistic identities as ChatSurface. The workspace owns native
      // banners, dock badges and the notification inbox; this surface never emits them.
      useChatStore.getState()._applyStreamEvent(id, event)
      if (event.type === 'run.failed') setError(event.error)
    })
    const reconnect = eventSocket.onConnected(() => void recover())
    void recover()
    return () => {
      alive = false
      off()
      reconnect()
    }
  }, [sessionId, forget, attempt])

  const reset = () => {
    if (running || creation.current) return
    void startInProject(session?.projectId ?? null)
  }
  const startInProject = async (projectId: string | null) => {
    if (running || creation.current) return
    creation.current = landIn(projectId, (scope) => createIn(scope, false))
    try {
      const created = await creation.current
      if (created) {
        files.clearAttachments()
        selectSession(created.id)
        setError(null)
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Could not start a conversation.'))
    } finally {
      creation.current = null
    }
  }
  const resume = async (id: string) => {
    if (creation.current || id === sessionId) return
    try {
      const restored = await backendClient.getSession(id)
      applyServerSession(restored)
      files.clearAttachments()
      selectSession(id)
      setError(null)
    } catch (cause) {
      setError(
        isMissingSession(cause)
          ? 'That conversation was deleted.'
          : errorMessage(cause, 'Could not open the conversation.'),
      )
    }
  }
  /** Leave the current conversation (its folder was removed); the island lands anew. */
  const leave = useCallback(() => {
    if (target.current) forget(target.current)
  }, [forget])
  /** Retry what failed: restore or land the conversation and refresh it again. */
  const retry = useCallback(() => {
    setError(null)
    setStartFailed(false)
    setAttempt((value) => value + 1)
    return prepare()
  }, [prepare])
  return {
    files,
    scrolling,
    sessionId,
    draftState,
    session,
    running,
    error,
    startFailed,
    send,
    stop: runtime.stopGeneration,
    reset,
    startInProject,
    resume,
    prepare,
    retry,
    leave,
    draft,
    setDraft,
    composerRef,
    connections,
    models,
    model,
    reasoningEffort,
  }
}
