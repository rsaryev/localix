import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowDown } from 'lucide-react'

import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { PulsingDot } from '@localixai/kit/pulsing-dot'
import { useSessionRuntime, type AgentOptions } from '@/features/chat/model/agent-runtime'
import { useQuestionUiStore } from '@/features/chat/model/questionUi'
import { logCurrentChatMessages, useSessionById, useChatStore } from '@/features/chat/model/store'
import { WorkItemSessionProvider } from '@localixai/plugin-sdk/ui/work-item-session'
import { useJobTerminal } from '@/features/chat/model/useJobTerminal'
import { AWAITING_ANSWER_LABEL } from '@/features/chat/model/messageActivity'
import { EmptyState } from '@/features/chat/ui/EmptyState'
import { PromptInput } from '@/features/chat/ui/prompt-input'
import { RuntimeSessionsPanel } from '@/features/chat/ui/RuntimeSessionsPanel'
import { ComposerContextBar } from './ComposerContextBar'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useComposerAttachments } from '@/shared/lib/attachments/useComposerAttachments'
import { ChatHeaderActions } from './ChatHeaderActions'
import { useMessageActions } from '../model/useMessageActions'
import { useMessageEdit } from '../model/useMessageEdit'
import { useComposerPrefill } from '../model/useComposerPrefill'
import { useComposerHeight } from '../model/useComposerHeight'
import { useSendMessage } from '../model/useSendMessage'
import { useChatAutoScrollTriggers } from '../model/useChatAutoScrollTriggers'
import { useConnections } from '@/features/chat/ui/prompt-input/useConnections'
import { buildSessionChain } from '@localixai/plugin-sdk/ui/session-tree'
import { findSessionInState } from '@/features/chat/model/findSession'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import type { ReasoningEffort } from '@/features/chat/model/reasoning'
import { useAutoScroll } from '@/shared/hooks/useAutoScroll'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { composerDrafts } from '@/shared/lib/composerDrafts'
import { useWorkspaceReloader } from '@/features/chat/model/useWorkspace'
import { useActiveTabRefs } from '@/features/workspace-grid/model'
import { SessionSurface } from '@/shared/contrib/sessionSurfaces'
import { createChatSurfaceSnapshotSelector } from '../model/chatSurfaceSnapshot'
import {
  isChatBodyPending,
  shouldAnimateEmptyDeparture,
  type ChatEmptyTransitionSnapshot,
} from '../model/chatEmptyTransition'
import { findCatalogModelForConnection } from '@localixai/agent/catalog'
import { sessionRoute } from '@/shared/api/contracts'
import { activeConversationDraft } from '@/features/chat/model/conversationStartStrategy'
import type { MessageBinding } from '@/shared/api/contracts'
import { useSystemContextManifest } from '../model/useSystemContextManifest'

// The transcript pulls in Markdown, syntax highlighting, virtualization, and all
// tool-result renderers. Keep that graph off the empty/new-chat startup path and
// load it as one boundary when the first message is actually present. One shared
// boundary also avoids a separate loading flash for every message/tool part.
const LazyMessageList = lazy(async () => {
  const module = await import('@/features/chat/ui/MessageList')
  return { default: module.MessageList }
})

// Message search and human-in-the-loop forms are interaction-only surfaces.
// Keeping them behind their own boundaries avoids preloading every search/HITL
// renderer for the common read-and-compose path.
const LazyMessageSearch = lazy(async () => {
  const module = await import('@/features/chat/ui/MessageSearch')
  return { default: module.MessageSearch }
})

// The session source registry. Its shell is tiny; Vaul and the list body arrive on first open.

const LazyChatInteractionOverlay = lazy(async () => {
  const module = await import('@/features/chat/ui/hitl/ChatInteractionOverlay')
  return { default: module.ChatInteractionOverlay }
})

interface ChatSurfaceProps {
  /** The session this surface renders + streams. Multiple surfaces (one per group)
   *  can be mounted at once, each bound to its own session. */
  sessionId: string | null
  /** True for the single focused surface — owns the global side-effects (the git
   *  poller). Background surfaces render + stream only. */
  isFocused: boolean
  resolvedTheme: ResolvedTheme
}

/**
 * One chat session's full surface — header + message list + composer + HITL overlay,
 * with its OWN scroll instance and runtime actions. Mountable N times (one per editor
 * group); the focused instance additionally drives the singleton side-effects.
 */
export function ChatSurface({ sessionId, isFocused, resolvedTheme }: ChatSurfaceProps) {
  // The focused editor tab's link candidate — the composer's auto-link chip.
  const activeTabLinks = useActiveTabRefs()
  // Stable global actions — session data uses narrow selectors below.
  const { createSession, setReasoningEffort, setModelSelection } = useChatStore(
    useShallow((s) => ({
      createSession: s.createSession,
      setReasoningEffort: s.setReasoningEffort,
      setModelSelection: s.setModelSelection,
    })),
  )
  const activeSession = useSessionById(sessionId)
  const activeSessionId = sessionId
  // Personalizes the empty-state greeting by first name (matches the splash).
  const displayName = useSettingsStore((s) => s.settings.displayName)
  // Empty state swaps starters for a connect prompt when no provider is connected.
  const hasConnection = useChatStore((s) =>
    s.connections.some((connection) => connection.hasApiKey),
  )
  // De-globalized run flag: this session's own `isRunning`.
  const isGenerating = activeSession?.isRunning ?? false
  const agentRuntime = useSessionRuntime(sessionId)
  const openQuestionId = useQuestionUiStore((state) => sessionId && state.openBySession[sessionId])
  const openQuestion = activeSession?.questions?.find((question) => question.id === openQuestionId)
  const lastLoggedSessionRef = useRef<string | null>(null)
  const { composerRef, composerHeight } = useComposerHeight()
  // Seeded from the persisted draft: a reload or relaunch reopens the half-typed message.
  const [prompt, setPrompt] = useState(() => (sessionId ? composerDrafts.get(sessionId) : ''))
  const systemContext = useSystemContextManifest(activeSessionId, activeSession?.messages ?? [])

  // Per-session composer drafts: the composer doesn't remount on session switch,
  // so save the outgoing chat's draft and restore the incoming one's — otherwise
  // a half-typed message leaks into the next chat (and is lost for the last one).
  const promptRef = useRef(prompt)
  // Latest-prompt mirror assigned post-commit (never during render). Declared
  // BEFORE the session-switch effect so it runs first each commit and the save
  // below always reads the outgoing session's freshest draft.
  // Every edit is recorded against the session it was typed in (the store debounces the
  // write); recording only on a switch lost a draft to a quit or reload in the same chat.
  const draftSessionRef = useRef<string | null>(sessionId)
  useEffect(() => {
    promptRef.current = prompt
    if (draftSessionRef.current) composerDrafts.set(draftSessionRef.current, prompt)
  }, [prompt])
  useEffect(() => {
    const prev = draftSessionRef.current
    if (prev === sessionId) return // first mount / no change
    if (prev) composerDrafts.set(prev, promptRef.current)
    draftSessionRef.current = sessionId
    setPrompt(sessionId ? composerDrafts.get(sessionId) : '')
  }, [sessionId])

  const { openIfJobSession } = useJobTerminal()

  const connectionsState = useConnections(activeSessionId)
  const { models } = useModelsCatalog()
  const reloadWorkspace = useWorkspaceReloader()
  const { scrollRef, showScrollToBottom, scrollToBottom, forceScrollToBottom } =
    useAutoScroll<HTMLDivElement>(activeSessionId, isFocused)

  const connectedProviderIds = useMemo(
    () => new Set(connectionsState.connections.map((connection) => connection.providerId)),
    [connectionsState.connections],
  )
  const filteredModels = useMemo(
    () =>
      connectedProviderIds.size > 0
        ? models.filter((model) => connectedProviderIds.has(model.providerId))
        : models,
    [models, connectedProviderIds],
  )

  const sessionMessages = activeSession?.messages
  const activeMessages = useMemo(() => sessionMessages ?? [], [sessionMessages])
  const snapshotSelector = useMemo(() => createChatSurfaceSnapshotSelector(), [])
  const transcriptSnapshot = snapshotSelector(activeMessages)
  const { userText, activeToolName } = transcriptSnapshot
  // Text deltas must not enqueue passive tip effects when the visible context is unchanged.
  const tipContext = useMemo(() => ({ userText, activeToolName }), [userText, activeToolName])
  // A closed sub-agent is read-only for everyone — its delegator closed it for good.
  const activeSessionIsClosed = Boolean(activeSession?.closedAt)
  const activeSessionIsReadOnly =
    activeSession?.readOnly === true ||
    activeSessionIsClosed ||
    activeSession?.sessionKind === 'job' ||
    activeSession?.sessionKind === 'system'

  const nav = useRoutedNavigation()
  const goToRuntimeSession = useCallback(
    (id: string) => {
      const target = findSessionInState(useChatStore.getState(), id)
      nav.goToSession(id, target ? { project: target.projectId } : undefined)
    },
    [nav],
  )
  const revealRuntimeWorker = useCallback(
    (id: string) => {
      if (openIfJobSession(id)) return
      goToRuntimeSession(id)
    },
    [openIfJobSession, goToRuntimeSession],
  )
  const runtimeScopeRootId = useChatStore(
    (state) =>
      buildSessionChain(findSessionInState(state, activeSessionId), state.allSessions)[0]?.id ??
      activeSessionId,
  )

  // The composer speaks for the session's own participant. A group's per-member picker asks
  // for a member's route by handle instead; this surface drives a private chat.
  const activeRoute = activeSession ? sessionRoute(activeSession) : null
  const model = activeRoute?.modelId ?? ''
  const reasoningEffort = activeRoute?.reasoningEffort ?? 'low'
  // Stable identities: the model picker is memoized, and this surface re-renders on
  // every composer keystroke (the draft lives here) — inline arrows here would hand
  // it fresh props each stroke and its `memo()` would never bail.
  const selectModel = useCallback(
    async (
      connectionId: string,
      nextModel: string,
      nextReasoningEffort?: ReasoningEffort,
      // Which participant the choice is for. Absent on a chat that does not exist yet, where
      // the store falls back to the freshly created session's own participant.
      agentId?: string,
    ) => {
      let nextSessionId = activeSessionId
      if (!nextSessionId) {
        const session = await createSession(undefined, activeConversationDraft())
        nextSessionId = session?.id ?? null
      }
      if (!nextSessionId) return
      await setModelSelection(nextSessionId, connectionId, nextModel, nextReasoningEffort, agentId)
    },
    [activeSessionId, createSession, setModelSelection],
  )
  const selectReasoningEffort = useCallback(
    // `agentId` is whose effort it is. Absent — the compact control beside the composer, which
    // speaks for the conversation — the store falls back to its own participant.
    (nextEffort: ReasoningEffort, agentId?: string) => {
      if (!activeSessionId) return
      void setReasoningEffort(activeSessionId, nextEffort, agentId)
    },
    [activeSessionId, setReasoningEffort],
  )
  const catalogModel = useMemo(
    () =>
      findCatalogModelForConnection(
        models,
        connectionsState.connections,
        activeRoute?.providerConnectionId,
        model,
      ),
    [activeRoute?.providerConnectionId, connectionsState.connections, model, models],
  )

  const { attachments, gate, addFiles, addVoice, removeAttachment, clearAttachments } =
    useComposerAttachments(catalogModel?.inputModalities)

  // Staged attachments are composer state too: clear them on a chat switch so a
  // file added for one conversation can't be sent with another. (Drafts persist
  // per-session; attachments are transient — staged then sent — so we clear,
  // which also revokes their object URLs.)
  const attachSessionRef = useRef(sessionId)
  useEffect(() => {
    if (attachSessionRef.current === sessionId) return
    attachSessionRef.current = sessionId
    clearAttachments()
  }, [sessionId, clearAttachments])

  const agentOpts = useMemo<AgentOptions>(
    () => ({ model, reasoningEffort }),
    [model, reasoningEffort],
  )

  const {
    lastSuccessfulUsage,
    latestContextAttempt,
    latestContextWindow,
    sessionUsage: loadedWindowUsage,
    latestCacheDiagnostics,
  } = transcriptSnapshot
  const sessionUsage = activeSession?.sessionUsage ?? loadedWindowUsage

  useEffect(() => {
    if (!activeSession) return
    if (lastLoggedSessionRef.current === activeSession.id) return
    lastLoggedSessionRef.current = activeSession.id
    logCurrentChatMessages(activeSession.id, activeSession.messages)
  }, [activeSession])

  useChatAutoScrollTriggers({
    pendingInteraction: agentRuntime.pendingInteraction,
    scrollToBottom,
    forceScrollToBottom,
  })

  const { forkSession, regenerate, onRollback, onSwitchBranch, onEdit, onOpenThread } =
    useMessageActions({
      activeSessionId,
      activeSessionIsReadOnly,
      goToSession: nav.goToSession,
      reloadWorkspace: () => void reloadWorkspace(),
      setPrompt,
      agentRuntime,
      agentOpts,
    })

  // Composer-based editing: clicking Edit on a past user message loads
  // its text into THIS composer (with an "Editing" banner) instead of an inline
  // transcript textarea. `onEdit` (the fork-on-edit backend call) is reused as the
  // persist step; `beginEdit` is what the message action now triggers.
  const messageEdit = useMessageEdit({
    activeSessionId,
    prompt,
    setPrompt,
    editMessage: onEdit,
  })

  const onSend = useSendMessage({
    prompt,
    setPrompt,
    attachments,
    clearAttachments,
    activeSessionId,
    agentRuntime,
    agentOpts,
    forkSession,
    forceScrollToBottom,
    goToSession: nav.goToSession,
  })
  const onSendWithSystemContext = useCallback(
    (text?: string, bindings?: MessageBinding[], internal?: boolean) => {
      const selection = systemContext.selectionBinding
      onSend(text, selection ? [...(bindings ?? []), selection] : bindings, internal)
    },
    [onSend, systemContext.selectionBinding],
  )

  // Below onSend on purpose: a `submit` insert from a contributed analysis surface
  // rides the same send pipeline as the composer's own Enter.
  useComposerPrefill({
    composerRef,
    setPrompt,
    addFiles,
    sessionId,
    send: (text, internal) => onSendWithSystemContext(text, undefined, internal),
  })

  const onRegenerate = activeSessionIsReadOnly ? undefined : regenerate

  const hasMessages = activeMessages.length > 0
  const isSessionBodyLoading = isChatBodyPending(sessionId, activeSession)

  // Soften the EmptyState→transcript swap: when the first rows land (the
  // optimistic send paints them within a frame of Enter), keep the greeting
  // mounted for one brief reverse fade-up overlaying the arriving rows — the
  // swap reads as a transition, not a teleport. CSS-only leave (fixed-timeout
  // unmount); reduced motion falls back to the instant swap via the global kill.
  const [emptyLeaving, setEmptyLeaving] = useState(false)
  const emptyTransitionRef = useRef<ChatEmptyTransitionSnapshot>({
    sessionId,
    hasMessages,
    bodyReady: !isSessionBodyLoading,
  })
  useEffect(() => {
    const current = {
      sessionId,
      hasMessages,
      bodyReady: !isSessionBodyLoading,
    }
    const previous = emptyTransitionRef.current
    emptyTransitionRef.current = current
    if (shouldAnimateEmptyDeparture(previous, current)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leave-window latch, driven by the hasMessages flip itself.
      setEmptyLeaving(true)
      const timer = setTimeout(() => setEmptyLeaving(false), 240)
      return () => clearTimeout(timer)
    }
    // A route switch also cancels an in-flight leave animation from the outgoing
    // chat, including messageful→messageful switches where hasMessages is stable.
    if (emptyLeaving) setEmptyLeaving(false)
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- emptyLeaving is only reset here, never a trigger.
  }, [sessionId, hasMessages, isSessionBodyLoading])

  return (
    <WorkItemSessionProvider sessionId={sessionId}>
      {/* Render-null lifecycle surfaces a plugin attaches to a live chat — a repository poller is
          one. The host reports only what it owns: whether this chat is focused, and whether a turn
          is running. Anything else a surface needs about the session's directory it watches for
          itself, because the host no longer knows what would make it change. */}
      <SessionSurface
        surface="chat.background"
        sessionId={isFocused ? activeSessionId : null}
        context={{
          focused: isFocused,
          isRunning: activeSession?.isRunning,
        }}
      />
      <div className="relative flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="shrink-0 max-sm:pt-10">
          <div className="flex h-[var(--chrome-control-xl)] w-full items-center justify-between gap-3 px-4 max-sm:h-[var(--chrome-control-md)] max-sm:px-3">
            {/* Header row: just the header actions (Find, panel controls), right-aligned.
              The navigation breadcrumb lives in the app-wide top bar (WorkspaceShell
              titlebar), NEVER inside the chat — an empty spacer pushes the actions right. */}
            <div className="min-w-0 flex-1" />
            <ChatHeaderActions activeSessionId={activeSessionId} hasMessages={hasMessages} />
          </div>
        </div>

        {/* The find bar owns a global shortcut/store and therefore exists only in
            the single focused warm surface. Hidden chats keep their transcript
            mounted, but must not compete for the query or active match. */}
        {hasMessages && isFocused && (
          <Suspense fallback={null}>
            <LazyMessageSearch messages={activeMessages} sessionId={activeSessionId} />
          </Suspense>
        )}

        <div
          ref={scrollRef}
          data-ui-scroll-container
          // `overscroll-contain`: reaching either end of the transcript must not
          // chain the wheel into the workspace shell behind it.
          // `@container`: the minimap rail measures the gutter against THIS width (`100cqw`), so
          // it can stop short of the scroll box instead of overflowing it sideways.
          // `virtual-scroller`: the transcript is virtualized and pinned by its own follow logic,
          // so browser scroll anchoring would correct `scrollTop` a second time on every height
          // change of a tool row.
          className="@container virtual-scroller flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin [scrollbar-gutter:stable]"
        >
          <div className="relative mx-auto flex min-h-full w-full max-w-(--chat-measure) flex-col pb-4 max-sm:max-w-full">
            {hasMessages ? (
              <Suspense
                fallback={<LoadingHint className="flex-1">Rendering conversation…</LoadingHint>}
              >
                <LazyMessageList
                  messages={activeMessages}
                  isGenerating={isGenerating}
                  streamingMessageId={activeSession?.streamingMessageId}
                  scrollRef={scrollRef}
                  onContentSizeChange={scrollToBottom}
                  sessionId={activeSessionId}
                  navActive={isFocused}
                  onRegenerate={onRegenerate}
                  onRollback={activeSessionIsReadOnly ? undefined : onRollback}
                  onEdit={activeSessionIsReadOnly ? undefined : messageEdit.beginEdit}
                  onSwitchBranch={activeSessionIsReadOnly ? undefined : onSwitchBranch}
                  onOpenThread={activeSessionIsReadOnly ? undefined : onOpenThread}
                  // A pending card outranks any phase: the run is waiting on the reader, not
                  // on a model, and the client already knows that without a new host event.
                  phaseLabel={
                    agentRuntime.pendingInteraction
                      ? AWAITING_ANSWER_LABEL
                      : activeSession?.activePhase?.label
                  }
                />
              </Suspense>
            ) : null}
            {/* Kept at a STABLE tree position across the swap so the leaving
                greeting is the same mounted element (its own entrance never
                replays) — only the wrapper flips to a fading overlay. */}
            {isSessionBodyLoading && !hasMessages ? (
              <LoadingHint className="flex-1">Loading conversation…</LoadingHint>
            ) : null}
            {((!hasMessages && !isSessionBodyLoading) || emptyLeaving) && (
              <div
                className={
                  hasMessages
                    ? 'pointer-events-none absolute inset-0 flex flex-col'
                    : 'flex flex-1 flex-col'
                }
                style={
                  hasMessages
                    ? { animation: 'fade-up var(--dur-fast) var(--ease-soft) reverse both' }
                    : undefined
                }
              >
                <EmptyState
                  name={displayName}
                  hasConnection={hasConnection}
                  sessionId={sessionId}
                />
              </div>
            )}
          </div>
        </div>

        {showScrollToBottom ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-(--z-sticky)"
            style={{ bottom: composerHeight + 12 }}
          >
            <div className="mx-auto flex w-full max-w-(--chat-measure) justify-center px-6 max-sm:max-w-full max-sm:px-4">
              <div className="relative">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    isGenerating ? 'Scroll to latest (still generating)' : 'Scroll to bottom'
                  }
                  title={
                    isGenerating
                      ? 'Scroll to latest — new content is arriving below'
                      : 'Scroll to bottom'
                  }
                  // FORCE: this button only exists while the reader is unpinned, so a
                  // follow-preserving call would be a no-op on the one control whose entire job is
                  // to go down.
                  onClick={() => forceScrollToBottom('smooth')}
                  // The button is the HIT TARGET (size-10) and the glass pill inside it is the
                  // visual (size-8): the padding ring keeps a comfortable click area without
                  // making the material look chunky. `lx-glass-trigger` is what drives the
                  // pill's hover/press, since a `:hover` on the pill would drop out over that
                  // ring. Colours come from theme tokens, so the pill inverts in light mode
                  // instead of staying a white-on-white ghost.
                  className="lx-glass-trigger pointer-events-auto size-10 animate-[scroll-btn-in_220ms_var(--ease-soft)] rounded-full border-0 bg-transparent p-1 text-text-soft shadow-none hover:bg-transparent hover:text-text-strong active:bg-transparent"
                >
                  <span className="lx-glass flex size-8 items-center justify-center rounded-full">
                    <ArrowDown className="size-3.5" />
                  </span>
                </Button>
                {isGenerating && (
                  <PulsingDot className="pointer-events-none absolute -right-0.5 -top-0.5 size-2 text-status-info ring-2 ring-background" />
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div
          ref={composerRef}
          className="relative mx-auto w-full max-w-(--chat-measure) shrink-0 max-sm:max-w-full"
        >
          <PromptInput
            activeTabLinks={activeTabLinks}
            prompt={prompt}
            setPrompt={setPrompt}
            isGenerating={isGenerating}
            isFocused={isFocused}
            activeSessionId={activeSessionId}
            activeConnectionId={connectionsState.activeId}
            hasConnection={Boolean(connectionsState.activeConnection)}
            model={model}
            setModel={selectModel}
            models={filteredModels}
            connectionsState={connectionsState}
            reasoningEffort={reasoningEffort}
            setReasoningEffort={selectReasoningEffort}
            resolvedTheme={resolvedTheme}
            usage={lastSuccessfulUsage}
            latestContextAttempt={latestContextAttempt}
            contextDiagnostics={latestContextWindow}
            sessionUsage={sessionUsage}
            cacheDiagnostics={latestCacheDiagnostics}
            readOnlyReason={
              activeSessionIsClosed
                ? 'This sub-agent was closed and takes no more messages'
                : activeSessionIsReadOnly
                  ? 'This runtime session is read-only'
                  : undefined
            }
            tipContext={tipContext}
            runtimePanel={
              <>
                <RuntimeSessionsPanel
                  scopeRootId={runtimeScopeRootId}
                  activeSessionId={activeSessionId}
                  onSelect={revealRuntimeWorker}
                />
              </>
            }
            hasInteraction={Boolean(openQuestion || agentRuntime.pendingInteraction)}
            interactionOverlay={
              openQuestion || agentRuntime.pendingInteraction ? (
                <Suspense fallback={<LoadingHint className="min-h-14 text-xs" />}>
                  <LazyChatInteractionOverlay
                    interaction={agentRuntime.pendingInteraction}
                    queuedQuestion={
                      openQuestion && sessionId ? { sessionId, question: openQuestion } : undefined
                    }
                    submittingRequestId={agentRuntime.submittingInteractionId}
                    keyboardActive={isFocused}
                    onAnswer={agentRuntime.answerInteraction}
                    onSubmitSecret={agentRuntime.submitSecretValue}
                    onDismiss={agentRuntime.dismissInteraction}
                    onDefer={agentRuntime.deferInteraction}
                  />
                </Suspense>
              ) : null
            }
            onSend={onSendWithSystemContext}
            onStop={agentRuntime.stopGeneration}
            serverQueue={activeSession?.queuedMessages}
            attachments={attachments}
            onAddFiles={(files) => void addFiles(files)}
            onAddVoice={(blob, durationMs) => void addVoice(blob, durationMs)}
            onRemoveAttachment={removeAttachment}
            attachmentGate={gate}
            loops={activeSession?.loops}
            systemContext={systemContext}
            contextBar={
              <ComposerContextBar
                activeSessionId={activeSessionId}
                autoApprovedTools={activeSession?.autoApprovedTools}
                running={activeSession?.isRunning ?? false}
              />
            }
            editingOriginalText={messageEdit.editing?.originalText ?? null}
            onCancelEdit={messageEdit.cancelEdit}
            onSubmitEdit={messageEdit.submitEdit}
          />
        </div>
      </div>
    </WorkItemSessionProvider>
  )
}
