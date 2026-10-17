import type { ComposerDropzone } from '@/features/chat/ui/prompt-input/useComposerDropzone'
import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { MessageList } from '@/features/chat/ui/MessageList'
import { WorkItemSessionProvider } from '@localixai/plugin-sdk/ui/work-item-session'
import { PromptInput } from '@/features/chat/ui/prompt-input/PromptInput'
import { useChatStore } from '@/features/chat/model/store'
import { useTheme } from '@/shared/theme/useTheme'
import type { useQuickChat } from '../model/useQuickChat'
import { useIslandInputFocus } from '../model/useIslandInputFocus'

export function QuickChat({
  chat,
  attention,
  notice,
  attentionActive,
  dropzone,
  focused,
  onOpen,
}: {
  chat: ReturnType<typeof useQuickChat>
  attention: ReactNode
  notice?: ReactNode
  attentionActive: boolean
  dropzone: ComposerDropzone
  focused: boolean
  onOpen: (id: string) => void
}) {
  const { resolvedTheme } = useTheme()
  useIslandInputFocus(chat.composerRef, focused && !attentionActive, chat.sessionId ?? undefined)
  return (
    <section aria-label="Quick chat" className="flex min-h-0 flex-col gap-3">
      {Boolean(chat.session?.messages.length) && !attentionActive && (
        <WorkItemSessionProvider sessionId={chat.sessionId}>
          <div
            ref={chat.scrolling.scrollRef}
            className="max-h-80 overflow-y-auto overscroll-contain"
            aria-label="Conversation"
          >
            <MessageList
              edgePadding="none"
              messages={chat.session!.messages}
              isGenerating={chat.running}
              streamingMessageId={chat.session?.streamingMessageId}
              scrollRef={chat.scrolling.scrollRef}
              sessionId={chat.sessionId}
              navActive={false}
              onContentSizeChange={chat.scrolling.scrollToBottom}
            />
          </div>
        </WorkItemSessionProvider>
      )}
      {chat.error && (
        <p role="alert" className="lx-island-alert">
          {chat.error}
        </p>
      )}
      {attention}
      {!attentionActive && notice}
      <div ref={chat.composerRef} hidden={attentionActive}>
        <PromptInput
          layout="embedded"
          showModelPicker={false}
          showContextBar={false}
          showTips={false}
          dropzone={dropzone}
          idleAction={
            chat.sessionId && (
              <IconButton
                size="sm"
                tooltip="Open full conversation"
                aria-label="Open full conversation"
                onClick={() => onOpen(chat.sessionId!)}
              >
                <ArrowUpRight />
              </IconButton>
            )
          }
          draftState={chat.draftState}
          prompt={chat.draft}
          setPrompt={chat.setDraft}
          isGenerating={chat.running}
          isFocused={focused && !attentionActive}
          activeSessionId={chat.session?.id ?? null}
          activeConnectionId={chat.connections.activeId}
          hasConnection={Boolean(chat.connections.activeConnection)}
          connectionsState={chat.connections}
          model={chat.model}
          models={chat.models}
          setModel={async (connectionId, modelId, effort, agentId) => {
            const session = await chat.prepare()
            if (session)
              await useChatStore
                .getState()
                .setModelSelection(session.id, connectionId, modelId, effort, agentId)
          }}
          reasoningEffort={chat.reasoningEffort}
          setReasoningEffort={(effort) => {
            if (chat.session)
              void useChatStore.getState().setReasoningEffort(chat.session.id, effort)
          }}
          resolvedTheme={resolvedTheme}
          onSend={chat.send}
          onStop={chat.stop}
          serverQueue={chat.session?.queuedMessages}
          attachments={chat.files.attachments}
          attachmentGate={chat.files.gate}
          onAddFiles={(files) => void chat.files.addFiles(files)}
          onAddVoice={(...args) => void chat.files.addVoice(...args)}
          onRemoveAttachment={chat.files.removeAttachment}
        />
      </div>
    </section>
  )
}
