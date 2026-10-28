import { cloneElement, lazy, Suspense, useCallback, useId, useState } from 'react'

import { ChipRow } from './ChipRow'
import { SessionSurface } from '@/shared/contrib/sessionSurfaces'
import { isModelRoutingTaskEnabled } from '@localixai/api/model-task-catalog'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { composerShellClassName } from './composerShell'
import { LocalixBorderBeam } from '@localixai/kit/localix-border-beam'

import { reasoningBeamIntensity } from '../../model/reasoning'
import { hasAuthoredInput } from '../../model/authoredMessage'
import { refFromToken } from '../../model/sendRefs'
import { composerAccessory } from './ComposerAccessory'
import { ComposerDropHint } from './ComposerDropHint'
import { composerPlaceholder } from './composerPlaceholder'
import { useComposerModel } from './useComposerModel'
import { useComposerStreamTip } from './useComposerStreamTip'
import { DraftSyncNotice } from './DraftSyncNotice'
import { ActionButtons } from './ActionButtons'
import { nextCaretInText, type CaretInText } from './caretInText'
import { ComposerHeaderStrips } from './ComposerHeaderStrips'
import { ComposerTextField } from './ComposerTextField'
import { ComposerContextManifest } from './ContextRefChips'
import { EditingBanner } from './EditingBanner'
import { ModelSearchSelect } from './ModelSearchSelect'
import { SessionPermissionModeChip } from './SessionPermissionModeChip'
import { PinnedSkillsRow } from './PinnedSkillsRow'
import type { PromptInputProps } from './promptInputProps'
import { useAtRefAutocomplete } from './useAtRefAutocomplete'
import { useChatInlineCompletion } from './useChatInlineCompletion'
import { useComposerBusSubmit } from './useComposerBusSubmit'
import { useComposerCommands } from './useComposerCommands'
import { useComposerContextRefs } from './useComposerContextRefs'
import { useComposerDropzone } from './useComposerDropzone'
import { useComposerMirror } from './useComposerMirror'
import { useComposerVoice } from './useComposerVoice'
import { useMessageBindingDrop } from './useMessageBindingDrop'
import { useComposerClientCommands } from './useComposerClientCommands'
import { useOpenResourceCommand } from './useOpenResourceCommand'
import { usePromptInputKeyboard } from './usePromptInputKeyboard'
import { useHistoryKeyDown } from './usePromptHistory'
import { usePromptSend } from './usePromptSend'
import { usePromptSessionView } from './usePromptSessionView'
import { useComposerFileInput } from './useComposerFileInput'
import { useDynamicSlashCommands } from './useDynamicSlashCommands'

import { useSlashArgOptions } from './useSlashArgOptions'
import { useModelCommand } from './model-command/useModelCommand'

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

  const dynamicCommands = useDynamicSlashCommands(activeSessionId, isFocused)
  const sessionView = usePromptSessionView(activeSessionId)
  const { activeProjectId, agent } = sessionView
  const modelCommand = useModelCommand(activeSessionId, activeProjectId, activeConnectionId)
  const loadDynamicOptions = useSlashArgOptions(
    activeSessionId,
    activeProjectId,
    modelCommand.loadOptions,
  )
  const composer = useComposerCommands(
    prompt,
    setPrompt,
    dynamicCommands,
    isFocused ? loadDynamicOptions : undefined,
    modelCommand.skipArg,
  )
  const { slash, slashArgs } = composer
  const openCommandActive = isFocused && slash.detected?.command.id === 'open'
  const openResource = useOpenResourceCommand(
    activeSessionId,
    openCommandActive,
    openCommandActive ? (slash.detected?.text ?? '') : '',
    setPrompt,
  )
  const selectedModel = useComposerModel(
    models,
    connectionsState.connections,
    activeConnectionId,
    model,
  )
  // The context gauge measures against the model's window.
  const contextWindow = selectedModel?.contextLength
  const ctxRefs = useComposerContextRefs(
    prompt,
    activeSessionId,
    props.activeTabLinks,
    contextWindow,
  )
  // Claude Code's habitual commands (`/clear`, `/resume`, `/rewind`, …), over the app's own actions.
  const clientCommands = useComposerClientCommands({
    sessionId: activeSessionId,
    setPrompt,
    onSend,
    onRollback: props.onRollback,
    usage: props.usage,
    latestAttempt: props.latestContextAttempt,
    contextDiagnostics: props.contextDiagnostics,
    contextWindow,
  })
  const { tip: streamTip, dismiss: dismissTip } = useComposerStreamTip({
    activeSessionId,
    isFocused,
    active: isFocused && !sessionView.awaitingAnswer,
    running: isGenerating,
    idleDraft: prompt.trim().length === 0 && !readOnlyReason && !isEditing,
    usage: props.usage,
    contextDiagnostics: props.contextDiagnostics,
    contextWindow,
    tipContext: props.tipContext,
  })
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

  const { settings } = useUserSettings()
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
    attachmentCount: attachments?.length ?? 0,
    submitOpenResource: openResource.submit,
    submitClientCommand: () =>
      modelCommand.submit(slash.detected, () => setPrompt('')) ||
      clientCommands.submit(slash.detected),
  })
  const attachmentItems = attachments ?? []
  // A message is sendable with text, attachments, OR pinned (drag-added) refs alone: the same
  // rule Enter and the send pipeline apply.
  const hasContent = hasAuthoredInput(prompt, attachmentItems.length + ctxRefs.pinnedRefs.length)
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
    !hasInteraction &&
    !readOnly &&
    !preparingSend &&
    ctxRefs.budget !== 'block' &&
    !openCommandActive,
  )
  // Every drop/link carrying the message-binding MIME resolves through one policy — and so
  // does the message Link button, which arrives on composerBus. See useMessageBindingDrop.
  const addMessageBinding = useMessageBindingDrop(activeSessionId, prompt, setPrompt, ctxRefs)
  const ownDropzone = useComposerDropzone({
    onAddFiles,
    onMessageBinding: addMessageBinding,
    attachEnabled: attachEnabled && !props.dropzone,
  })
  const dropzone = props.dropzone ?? ownDropzone
  const { dragKind, handleFiles } = dropzone
  const filePicker = useComposerFileInput(handleFiles, attachmentGate)
  // Pills under file references, and the ghost suggestion after the caret.
  const composerHighlight = useComposerMirror({ prompt, suggestionGhost })

  const placeholder = composerPlaceholder({
    hasConnection,
    hasModel: Boolean(model),
    readOnlyReason,
    isGenerating,
  })
  const beamIntensity = reasoningBeamIntensity(reasoningEffort)

  const contextManifest = (
    <ComposerContextManifest
      contextRefs={ctxRefs}
      attachments={attachmentItems}
      systemContext={props.systemContext}
      onRemoveAttachment={onRemoveAttachment}
    />
  )
  const { contextBar } = props
  const contextControls = (
    <>
      <SessionPermissionModeChip sessionId={activeSessionId} disabled={isGenerating || readOnly} />
      {contextManifest}
    </>
  )

  return (
    <div
      data-focus-part="chat"
      className="shrink-0 px-6 pb-6 pt-3 max-sm:px-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:pt-2"
    >
      {contextBar ? (
        cloneElement(contextBar, { children: contextControls })
      ) : (
        <ChipRow className="pb-2">{contextControls}</ChipRow>
      )}
      {isEditing && onCancelEdit && (
        <EditingBanner originalText={editingOriginalText ?? ''} onCancel={onCancelEdit} />
      )}
      <div
        // `bg-background/40 + backdrop-blur`, NOT the raised inset: `--surface-raised` mixes from
        // a DARKER ground than the chat's, so at any alpha the composer stayed a black patch of a
        // different color. Anchored at the same ground as the pane behind it, the fill only adds
        // density — same hue, slightly deeper, frosted — and the shell reads as a region OF the
        // window. The border and the focus glow carry the "this is the input" signal.
        className={composerShellClassName(focused, !props.dropzone && Boolean(dragKind))}
        data-agent-link-drop-target
        data-drop-active={!props.dropzone && dragKind ? 'true' : undefined}
        data-active-theme={props.resolvedTheme}
        onDragEnter={props.dropzone ? undefined : dropzone.handleDragEnter}
        onDragOver={props.dropzone ? undefined : dropzone.handleDragOver}
        onDragLeave={props.dropzone ? undefined : dropzone.handleDragLeave}
        onDrop={props.dropzone ? undefined : dropzone.handleDrop}
      >
        <ComposerDropHint />
        {props.draftState && <DraftSyncNotice state={props.draftState} />}
        <LocalixBorderBeam
          active={focused || isGenerating || beamIntensity > 0}
          variant={isGenerating ? 'working' : 'focus'}
          intensity={beamIntensity}
        />
        {/* Hidden file input driven by the paperclip button */}
        {filePicker.fileInput}
        <ComposerHeaderStrips
          tip={streamTip}
          onDismissTip={dismissTip}
          runtimePanel={props.runtimePanel}
          activeSessionId={activeSessionId}
          isFocused={isFocused}
          sessionUsage={props.sessionUsage}
          loops={props.loops}
        />
        {hasInteraction ? (
          props.interactionOverlay
        ) : (
          <>
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
              focused={focused}
              surfaceActive={isFocused}
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
              showAttach
              accessory={composerAccessory(serverQueue, activeSessionId, props.accessory)}
              leading={
                <ModelSearchSelect
                  models={models}
                  value={model}
                  onSelectionChange={props.setModel}
                  connectionsState={connectionsState}
                  disabled={isGenerating || readOnly}
                  reasoningEffort={reasoningEffort}
                  onReasoningEffortChange={props.setReasoningEffort}
                  agent={agent}
                  agentScope={activeProjectId ?? ''}
                  sessionId={activeSessionId}
                  focused={isFocused}
                />
              }
              hasPrompt={hasContent}
              canSend={canSend}
              isGenerating={isGenerating}
              hasApiKey={hasConnection && !readOnly}
              canAttach={attachEnabled}
              onAttachClick={() => void filePicker.openPicker()}
              onSend={handleSend}
              onStop={props.onStop}
              canRecord={voice.canRecord}
              isRecording={voice.recorder.isRecording}
              recordingSeconds={voice.recorder.seconds}
              onMicClick={voice.handleMicClick}
              onCancelRecording={voice.recorder.cancel}
            />
          </>
        )}
      </div>
      {/* Contributed status lines under the box (a status bar, as the prompt's footer row). Outside
          the shell and the interaction branch: it stays mounted while a question is open, and
          is told so it can hide its rows meanwhile. */}
      <SessionSurface
        key={activeSessionId ?? 'none'}
        surface="composer.footer"
        sessionId={activeSessionId}
        context={{ isFocused, hasInteraction }}
      />
      {clientCommands.confirmation}
    </div>
  )
}
