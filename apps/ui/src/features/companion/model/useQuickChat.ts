import { useComposerAttachments } from '@/shared/lib/attachments/useComposerAttachments'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAutoScroll } from '@/shared/hooks/useAutoScroll'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { needsSessionResync } from '@/shared/api/applyStreamEvent'
import { useChatStore } from '@/features/chat/model/store'
import { findSessionInState } from '@/features/chat/model/findSession'
import { scopedNewConversation } from '@/features/chat/model/conversationStartStrategy'
import { useSendMessage } from '@/features/chat/model/useSendMessage'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'
import { useViewState } from '@/shared/lib/view-state/useViewState'
import { viewStateStore } from '@/shared/lib/view-state/store'
import { useComposerDraft } from '@/features/chat/model/useComposerDraft'
import { useComposerPrefill } from '@/features/chat/model/useComposerPrefill'
import { useSessionRuntime } from '@/features/chat/model/agent-runtime'
import { useForkSession } from '@/features/chat/model/useForkSession'
import { useConnections } from '@/features/chat/ui/prompt-input/useConnections'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { sessionRoute } from '@/shared/api/contracts'
import { findCatalogModelForConnection } from '@localixai/agent/catalog'
import { reconcileAfterReconnect } from '@/features/chat/model/reconnect-reconcile'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

export const ISLAND_SESSION_KEY = 'localix_companion_session_v1'
/** The backend view-state record that both the island and the workspace read. */
const QUICK_CHAT = { kind: 'surface', key: 'quick-chat' } as const

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
  const prepare = useCallback(() => {
    if (creation.current) return creation.current
    creation.current = (async () => {
      const selected = await viewStateStore.ready(QUICK_CHAT)
      let id = selected.value && 'sessionId' in selected.value ? selected.value.sessionId : null
      if (!id && selected.revision === 0) id = legacy.current
      if (id) {
        const restored =
          findSessionInState(useChatStore.getState(), id) ?? (await backendClient.getSession(id))
        useChatStore.getState()._replaceSession(restored)
        if (selected.revision === 0) selectSession(id)
        return restored
      }
      const created = await useChatStore
        .getState()
        .createSession(undefined, scopedNewConversation(null, { kind: 'default' }))
      if (created) selectSession(created.id)
      return created
    })().finally(() => {
      creation.current = null
    })
    return creation.current
  }, [selectSession])
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
          applySession: (detail) => useChatStore.getState()._replaceSession(detail),
        })
      } catch (cause) {
        if (alive) setError(errorMessage(cause, 'Could not refresh this task.'))
      }
    }
    const off = eventSocket.onSessionEvent((id, event) => {
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
  }, [sessionId])

  const reset = () => {
    if (running || creation.current) return
    void startInProject(session?.projectId ?? null)
  }
  const startInProject = async (projectId: string | null) => {
    if (running || creation.current) return
    creation.current = useChatStore
      .getState()
      .createSession(undefined, scopedNewConversation(projectId, { kind: 'default' }))
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
      useChatStore.getState()._replaceSession(restored)
      files.clearAttachments()
      selectSession(id)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause, 'Could not open the conversation.'))
    }
  }
  return {
    files,
    scrolling,
    sessionId,
    draftState,
    session,
    running,
    error,
    send,
    stop: runtime.stopGeneration,
    reset,
    startInProject,
    resume,
    prepare,
    draft,
    setDraft,
    composerRef,
    connections,
    models,
    model,
    reasoningEffort,
  }
}
