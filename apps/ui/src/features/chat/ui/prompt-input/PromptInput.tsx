import { cloneElement, lazy, Suspense, useCallback, useId, useMemo, useRef, useState } from 'react'

import { findCatalogModelForConnection } from '@localixai/agent/catalog'
import { isModelRoutingTaskEnabled } from '@localixai/api/client'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { acceptAttribute } from '@/shared/lib/attachment-policy'
import { filesFromDesktopPick } from '@/shared/lib/attachments/file-staging'
import { desktopPickFiles } from '@/shared/lib/desktopDialogs'
import { DROP_TARGET_FOCUS_GLOW, DROP_TARGET_SURFACE_ACTIVE } from '@localixai/kit/drop-target'
import { LocalixBorderBeam } from '@localixai/kit/localix-border-beam'

import { loadPromptHistory } from '../../model/persistence'
import { reasoningBeamIntensity } from '../../model/reasoning'
import { refFromToken } from '../../model/sendRefs'
import { useStreamTip } from '../../model/streamTips'
import type { TipContext } from '../../model/tipSelection'
import { useTipSignals } from '../../model/tipSignals'
import { useComposerTips } from '../../model/useComposerTips'
import { useInlineCompletionTip } from '../../model/useInlineCompletionTip'
import { usePromptImprover } from '../../model/usePromptImprover'
import { ActionButtons } from './ActionButtons'
import { AddParticipantMenu } from './AddParticipantMenu'
import { RosterLockButton } from './RosterLockButton'
import { nextCaretInText, type CaretInText } from './caretInText'
import { ComposerHeaderStrips } from './ComposerHeaderStrips'
import { ComposerShellDecorations } from './ComposerShellDecorations'
import { ComposerTextField } from './ComposerTextField'
import { ComposerContextManifest } from './ContextRefChips'
import { EditingBanner } from './EditingBanner'
import { ModelSearchSelect } from './ModelSearchSelect'
import { PinnedSkillsRow } from './PinnedSkillsRow'
import type { PromptInputProps } from './promptInputProps'
import { mergeDynamicSlashCommands } from './slashCommands'
import { UsageIndicator } from './UsageIndicator'
import { useAtRefAutocomplete } from './useAtRefAutocomplete'
import { useChatInlineCompletion } from './useChatInlineCompletion'
import { useComposerBusSubmit } from './useComposerBusSubmit'
import { useComposerCommands } from './useComposerCommands'
import { useComposerContextRefs } from './useComposerContextRefs'
import { useComposerDropzone } from './useComposerDropzone'
import { useComposerMirror } from './useComposerMirror'
import { useComposerVoice } from './useComposerVoice'
import { useMessageBindingDrop } from './useMessageBindingDrop'
import { useOpenResourceCommand } from './useOpenResourceCommand'
import { usePluginCommands } from './usePluginCommands'
import { usePromptInputKeyboard } from './usePromptInputKeyboard'
import { useHistoryKeyDown } from './usePromptHistory'
import { usePromptSend } from './usePromptSend'
import { usePromptSessionView } from './usePromptSessionView'
import { useSkillCommands } from './useSkillCommands'
import { useSlashArgOptions } from './useSlashArgOptions'

export type { PromptInputProps } from './promptInputProps'

// Image previews, the lightbox, and the voice player are interaction-only. Keep
// their graph out of the primary composer until an attachment actually exists.
const AttachmentTray = lazy(() =>
  import('@/shared/ui/attachments/AttachmentTray').then(({ AttachmentTray }) => ({
    default: AttachmentTray,
  })),
)

/**
 * The chat composer: one draft, the commands and references typed into it, and the controls
 * around it. Each responsibility is its own hook or sub-component in this folder; this
 * component wires them in dependency order and owns only the shell and its layout.
 */
export function PromptInput(props: PromptInputProps) {
  const { prompt, setPrompt, isGenerating, isFocused, activeSessionId, activeConnectionId } = props
  const { hasConnection, model, models, reasoningEffort, serverQueue, attachments } = props
  const { onAddFiles, onRemoveAttachment, attachmentGate, readOnlyReason, onSend } = props
  const { hasInteraction = false, editingOriginalText, onCancelEdit, connectionsState } = props
  const isEditing = editingOriginalText != null
  const completionMenuId = useId()
  const [focused, setFocused] = useState(false)
  const [caretAtEnd, setCaretAtEnd] = useState(true)
  const [caretInText, setCaretInText] = useState<CaretInText | null>(null)
  const handleCaretChange = useCallback((atEnd: boolean, offset: number, text: string) => {
    setCaretAtEnd(atEnd)
    setCaretInText((prev) => nextCaretInText(prev, offset, text))
  }, [])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const skillCommands = useSkillCommands(activeSessionId, isFocused)
  const pluginCommands = usePluginCommands(activeSessionId, isFocused)
  const dynamicCommands = useMemo(
    () => mergeDynamicSlashCommands(pluginCommands, skillCommands),
    [skillCommands, pluginCommands],
  )
  // Gates the one-shot inline-completion hint so it lands after a first exchange, not in a
  // brand-new user's face. Read once.
  const hasSentBefore = useMemo(() => loadPromptHistory().length > 0, [])
  const scopeTips = useComposerTips(activeSessionId, isFocused)
  const composerTips = useInlineCompletionTip(
    scopeTips,
    hasSentBefore && prompt.trim().length === 0 && !readOnlyReason && !isEditing,
  )
  const sessionView = usePromptSessionView(activeSessionId, serverQueue)
  const { activeProjectId, participants } = sessionView
  const loadDynamicOptions = useSlashArgOptions(activeSessionId, activeProjectId)
  const composer = useComposerCommands(
    prompt,
    setPrompt,
    dynamicCommands,
    isFocused ? loadDynamicOptions : undefined,
  )
  const { slash, slashArgs } = composer
  const openCommandActive = isFocused && slash.detected?.command.id === 'open'
  const openResource = useOpenResourceCommand(
    activeSessionId,
    openCommandActive,
    openCommandActive ? (slash.detected?.text ?? '') : '',
    setPrompt,
  )
  // Memoized so the linear catalog scan doesn't re-run on every keystroke.
  const selectedModel = useMemo(
    () =>
      findCatalogModelForConnection(
        models,
        connectionsState.connections,
        activeConnectionId,
        model,
      ),
    [activeConnectionId, connectionsState.connections, model, models],
  )
  const contextWindow = selectedModel?.contextLength
  const ctxRefs = useComposerContextRefs(
    prompt,
    activeSessionId,
    props.activeTabLinks,
    contextWindow,
  )
  // The client answers the vocabulary the server's tip gates are written in, measured against
  // the SELECTED model's window.
  const tipSignals = useTipSignals({
    sessionId: activeSessionId,
    usage: props.usage,
    contextDiagnostics: props.contextDiagnostics,
    contextWindow,
  })
  const { tipContext } = props
  const fullTipContext = useMemo<TipContext>(
    () => ({
      userText: tipContext?.userText ?? '',
      activeToolName: tipContext?.activeToolName ?? null,
      signals: tipSignals,
    }),
    [tipContext, tipSignals],
  )
  const { tip: streamTip, dismiss: dismissTip } = useStreamTip(
    isGenerating && isFocused && !sessionView.awaitingAnswer,
    fullTipContext,
    composerTips,
  )
  // A COMPLETED @-menu link becomes a structured pinned ref (a chip inside the composer frame),
  // so a link has ONE representation; token shapes the pinned channel cannot parse fall back to
  // a text insert (returns false).
  const linkRef = useCallback(
    (tokenText: string): boolean => {
      const ref = refFromToken(tokenText)
      if (!ref) return false
      ctxRefs.addPinnedRef(ref)
      return true
    },
    [ctxRefs],
  )
  // Autocomplete only applies while no slash command owns the textarea. The caret offset is
  // valid only while measured against the CURRENT prompt.
  const atRef = useAtRefAutocomplete(
    slash.detected ? '' : prompt,
    setPrompt,
    activeSessionId,
    caretInText?.text === prompt ? caretInText.offset : null,
    linkRef,
    isFocused,
  )
  // Shell-style prompt-history recall yields the arrows to any open menu that owns navigation.
  const handleHistoryKeyDown = useHistoryKeyDown(
    activeSessionId,
    prompt,
    setPrompt,
    slash.isOpen || slashArgs.isMenuOpen || atRef.isOpen || openCommandActive,
  )

  const { settings, update: updateSettings } = useUserSettings()
  // Read the LIVE settings at mutation time, not through the render closure: the stepper is
  // clicked repeatedly and a patch built from a stale snapshot would undo the click before it.
  const setMaxTurns = useCallback(
    (next: number) =>
      updateSettings({
        agentSettings: { ...useUserSettings.getState().settings.agentSettings, maxTurns: next },
      }),
    [updateSettings],
  )
  const chatCompletion = useChatInlineCompletion({
    prompt,
    setPrompt,
    sessionId: activeSessionId,
    completionRefs: ctxRefs.completionRefs,
    enabled: isModelRoutingTaskEnabled(settings.agentSettings, 'inlineCompletion'),
    active:
      !readOnlyReason &&
      hasConnection &&
      Boolean(model) &&
      isFocused &&
      !isGenerating &&
      !slash.detected &&
      !slash.isOpen &&
      !slashArgs.isMenuOpen &&
      !atRef.isOpen &&
      !composer.commandPlaceholder,
    generating: isGenerating,
    focused,
    caretAtEnd,
  })
  const suggestionGhost = chatCompletion.suggestion

  const readOnly = Boolean(readOnlyReason)
  useComposerBusSubmit({
    activeSessionId,
    bindingsForSend: ctxRefs.bindingsForSend,
    onSend,
    readOnly,
    readOnlyReason,
  })

  const handleComposerKeyDown = usePromptInputKeyboard({
    activeSessionId,
    prompt,
    setPrompt,
    isEditing,
    onCancelEdit,
    isGenerating,
    readOnly,
    onStop: props.onStop,
    serverQueue,
    onInlineCompletionKeyDown: chatCompletion.handleKeyDown,
    onOpenResourceKeyDown: openResource.handleKeyDown,
    onHistoryKeyDown: handleHistoryKeyDown,
    onAtRefKeyDown: atRef.handleKeyDown,
    onComposerCommandKeyDown: composer.handleKeyDown,
  })
  const { handleSend, preparingSend } = usePromptSend({
    prompt,
    ctxRefs,
    onSend,
    isEditing,
    onSubmitEdit: props.onSubmitEdit,
    openCommandActive,
    submitOpenResource: openResource.submit,
  })
  const { improvePrompt, isImproving, didImproveRecently } = usePromptImprover({
    sessionId: activeSessionId,
    connectionId: activeConnectionId,
    model,
    reasoningEffort,
    text: prompt,
    setText: setPrompt,
  })

  const hasPrompt = Boolean(prompt.trim())
  const attachmentItems = attachments ?? []
  // A message is sendable with text, attachments, OR pinned (drag-added) refs alone.
  const hasContent = hasPrompt || attachmentItems.length > 0 || ctxRefs.pinnedRefs.length > 0
  const attachEnabled = Boolean(onAddFiles && hasConnection && model && !readOnly)
  const voice = useComposerVoice({
    isFocused,
    onAddVoice: props.onAddVoice,
    canCompose: Boolean(hasConnection && model && !readOnly),
    allowAudio: attachmentGate?.allowAudio ?? true,
  })
  const canSend = Boolean(
    hasConnection &&
    model &&
    hasContent &&
    !isImproving &&
    !hasInteraction &&
    !readOnly &&
    !preparingSend &&
    ctxRefs.budget !== 'block' &&
    !openCommandActive,
  )
  const canImprove = Boolean(
    hasConnection &&
    model &&
    hasPrompt &&
    !isGenerating &&
    !isImproving &&
    !hasInteraction &&
    !readOnly &&
    !preparingSend,
  )
  // Every drop/link carrying the message-binding MIME resolves through one policy — and so
  // does the message Link button, which arrives on composerBus. See useMessageBindingDrop.
  const addMessageBinding = useMessageBindingDrop(activeSessionId, prompt, setPrompt, ctxRefs)
  const dropzone = useComposerDropzone({
    onAddFiles,
    onMessageBinding: addMessageBinding,
    attachEnabled,
  })
  const { dragKind, handleFiles } = dropzone
  const handleAttachClick = useCallback(async () => {
    const files = filesFromDesktopPick(await desktopPickFiles())
    if (files === undefined) {
      fileInputRef.current?.click()
      return
    }
    // Opened without `extensions` on purpose: `pick_files` filters by extension only, while the
    // browser input's `accept` hint is partly MIME types (`acceptAttribute`), so a filter here
    // would diverge from it. The composer stages every kind rather than refusing after the pick.
    handleFiles(files)
  }, [handleFiles])
  // Mention pills in each member's colour, and the ghost suggestion after the caret.
  const composerHighlight = useComposerMirror({ prompt, suggestionGhost, participants })

  const placeholder = !hasConnection
    ? 'Connect OpenRouter to start…'
    : !model
      ? 'Select a model to start…'
      : readOnlyReason
        ? readOnlyReason
        : isGenerating
          ? 'Type a message to queue…'
          : 'Describe the outcome you want…'
  const beamIntensity = reasoningBeamIntensity(reasoningEffort)
  const shellBorder = dragKind
    ? DROP_TARGET_SURFACE_ACTIVE
    : focused
      ? DROP_TARGET_FOCUS_GLOW
      : isImproving
        ? 'border-composer-accent/40 shadow-[0_0_0_1px_color-mix(in_oklch,var(--composer-accent),transparent_84%),0_18px_48px_-30px_color-mix(in_oklch,var(--composer-accent-deep),transparent_20%)]'
        : 'border-control-border/60 hover:border-control-border-hover'

  const contextManifest = (
    <ComposerContextManifest
      contextRefs={ctxRefs}
      attachments={attachmentItems}
      systemContext={props.systemContext}
      onRemoveAttachment={onRemoveAttachment}
    />
  )
  const { contextBar } = props

  return (
    <div
      data-focus-part="chat"
      className="shrink-0 px-6 pb-6 pt-3 max-sm:px-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:pt-2"
    >
      {contextBar ? cloneElement(contextBar, { children: contextManifest }) : contextManifest}
      {isEditing && onCancelEdit && (
        <EditingBanner originalText={editingOriginalText ?? ''} onCancel={onCancelEdit} />
      )}
      <div
        // `bg-background/40 + backdrop-blur`, NOT the raised inset: `--surface-raised` mixes from
        // a DARKER ground than the chat's, so at any alpha the composer stayed a black patch of a
        // different color. Anchored at the same ground as the pane behind it, the fill only adds
        // density — same hue, slightly deeper, frosted — and the shell reads as a region OF the
        // window. The border and the focus glow carry the "this is the input" signal.
        className={`relative flex flex-col overflow-visible rounded-(--radius-composer) border bg-background/40 backdrop-blur-xl transition-[border-color,box-shadow] duration-(--dur-base) ${shellBorder}`}
        data-agent-link-drop-target
        data-drop-active={dragKind ? 'true' : undefined}
        data-active-theme={props.resolvedTheme}
        onDragEnter={dropzone.handleDragEnter}
        onDragOver={dropzone.handleDragOver}
        onDragLeave={dropzone.handleDragLeave}
        onDrop={dropzone.handleDrop}
      >
        <LocalixBorderBeam
          active={focused || isGenerating || isImproving || beamIntensity > 0}
          variant={isGenerating || isImproving ? 'working' : 'focus'}
          intensity={beamIntensity}
        />
        {/* Hidden file input driven by the paperclip button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={attachmentGate ? acceptAttribute(attachmentGate) : undefined}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) handleFiles(files)
            e.target.value = ''
          }}
        />
        <ComposerShellDecorations isImproving={isImproving} />
        <ComposerHeaderStrips
          tip={streamTip}
          onDismissTip={dismissTip}
          runtimePanel={props.runtimePanel}
          activeSessionId={activeSessionId}
          isFocused={isFocused}
          isGenerating={isGenerating}
          sessionUsage={props.sessionUsage}
          loops={props.loops}
          serverQueue={serverQueue}
          participants={participants}
          conversationFloor={sessionView.conversationFloor}
          addParticipantControl={
            <AddParticipantMenu
              seatedAgentIds={participants.map((participant) => participant.agentId)}
              projectId={activeProjectId ?? ''}
              onAdd={sessionView.participantsEditing.addParticipant}
            />
          }
          onRemoveParticipant={sessionView.participantsEditing.removeParticipant}
          participantsLocked={sessionView.rosterLocked}
          participantsLockControl={
            <RosterLockButton
              locked={sessionView.rosterLocked}
              settled={sessionView.rosterLockSettled}
              onChange={sessionView.participantsEditing.setRosterLocked}
            />
          }
        />
        {hasInteraction ? (
          props.interactionOverlay
        ) : (
          <>
            <div className="px-2.5 pb-[0.1rem] pt-[0.45rem] max-sm:px-2">
              <div className="min-w-0">
                <ModelSearchSelect
                  models={models}
                  value={model}
                  onSelectionChange={props.setModel}
                  connectionsState={connectionsState}
                  disabled={isGenerating || readOnly}
                  reasoningEffort={reasoningEffort}
                  onReasoningEffortChange={props.setReasoningEffort}
                  participants={participants}
                  participantScope={activeProjectId ?? ''}
                  sessionId={activeSessionId}
                  focused={isFocused}
                  maxTurns={settings.agentSettings?.maxTurns}
                  onMaxTurnsChange={setMaxTurns}
                />
              </div>
            </div>
            {/* Applied (pinned) skills — warmed into the session, not run */}
            <PinnedSkillsRow skills={sessionView.pinnedSkills} onChange={sessionView.setSkills} />
            <ComposerTextField
              onCompositionStart={chatCompletion.handleCompositionStart}
              onCompositionEnd={chatCompletion.handleCompositionEnd}
              composer={composer}
              atRef={atRef}
              openResource={openResource}
              openCommandActive={openCommandActive}
              completionMenuId={completionMenuId}
              suggestionGhost={suggestionGhost}
              placeholder={placeholder}
              disabled={!hasConnection || !model || readOnly}
              highlight={composerHighlight}
              onPaste={dropzone.handlePaste}
              onFocusChange={setFocused}
              onSubmit={handleSend}
              onKeyDown={handleComposerKeyDown}
              onCaretChange={handleCaretChange}
            />
            {onRemoveAttachment && attachmentItems.length > 0 && (
              <Suspense fallback={null}>
                <AttachmentTray attachments={attachmentItems} onRemove={onRemoveAttachment} />
              </Suspense>
            )}
            <ActionButtons
              hasPrompt={hasContent}
              canSend={canSend}
              canImprove={canImprove}
              isGenerating={isGenerating}
              isImproving={isImproving}
              didImproveRecently={didImproveRecently}
              hasApiKey={hasConnection && !readOnly}
              canAttach={attachEnabled}
              onAttachClick={() => void handleAttachClick()}
              accessory={
                <UsageIndicator
                  usage={props.usage}
                  latestAttempt={props.latestContextAttempt}
                  contextDiagnostics={props.contextDiagnostics}
                  sessionUsage={props.sessionUsage}
                  cacheDiagnostics={props.cacheDiagnostics}
                  contextWindow={contextWindow}
                />
              }
              onSend={handleSend}
              onStop={props.onStop}
              onImprove={() => void improvePrompt()}
              canRecord={voice.canRecord}
              isRecording={voice.recorder.isRecording}
              recordingSeconds={voice.recorder.seconds}
              onMicClick={voice.handleMicClick}
              onCancelRecording={voice.recorder.cancel}
            />
          </>
        )}
      </div>
    </div>
  )
}
