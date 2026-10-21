import { useCallback, type Dispatch, type SetStateAction } from 'react'

import { toast } from '@/shared/lib/notify'
import { composerBus } from '@/shared/lib/composerBus'
import { sendFailure } from '@/entities/chat/model/sendFailure'
import { sendChatMessage } from '@/entities/chat/model/sendChatMessage'
import { useChatStore } from '@/entities/chat/model/store'
import { activeConversationDraft } from '@/entities/chat/model/conversationStartStrategy'
import { appendPromptHistory } from '@/entities/chat/model/persistence'
import type { AgentOptions, SessionRuntime } from '@/entities/chat/model/agent-runtime'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'
import type { MessageBinding } from '@/shared/api/contracts'

export interface SendMessageDeps {
  createSession?: () => Promise<{ id: string; projectId?: string | null } | null | undefined>
  prompt: string
  setPrompt: Dispatch<SetStateAction<string>>
  attachments: PendingAttachment[]
  clearAttachments: (ids?: readonly string[]) => void
  activeSessionId: string | null
  agentRuntime: SessionRuntime
  agentOpts: AgentOptions
  forkSession: () => void
  forceScrollToBottom: () => void
  /** Stamp the URL with the session a fresh-chat send actually landed in, so the
   *  URL sync can never navigate away to a different draft afterwards. */
  goToSession: (id: string, opts?: { project?: string }) => void
}

/** Composer send handler: text plus already-normalized message bindings. */
export type SendMessage = (
  textOverride?: string,
  bindings?: MessageBinding[],
  /** Hide the user turn in the transcript — a machine-composed prompt (analysis wizard). */
  isInternal?: boolean,
) => void

/** Put a failed send back through the composer's normal staging boundary. This restores
 * text, inline assets and structured context refs without overwriting a newer draft the
 * user may have started while the RPC was in flight. */
export function restoreFailedSendDraft(
  sessionId: string,
  text: string,
  bindings: MessageBinding[],
): void {
  composerBus.insert({
    sessionId,
    text,
    ...(bindings.length > 0 ? { bindings } : {}),
    buffer: true,
  })
}

/**
 * The first message of a composer that has no chat yet: create the chat, then send into it.
 *
 * The draft must survive a failure, and it has only one home until the chat exists: this
 * session-less composer, which no composer-bus insert can address (an insert always names its
 * chat). So the staged files are unstaged only once the chat exists — after that a failure
 * restores the whole draft into the new chat through the bus — and a failed creation leaves them
 * staged and puts the text (`@` refs included, as their tokens) straight back.
 */
export async function sendToNewChat(args: {
  text: string
  messageBindings: MessageBinding[]
  isInternal?: boolean
  submittedAttachmentIds: readonly string[]
  clearAttachments: (ids?: readonly string[]) => void
  setPrompt: Dispatch<SetStateAction<string>>
  forceScrollToBottom: () => void
  goToSession: (id: string, opts?: { project?: string }) => void
  createSession?: () => Promise<{ id: string; projectId?: string | null } | null | undefined>
}): Promise<void> {
  const createSession =
    args.createSession ??
    (() => useChatStore.getState().createSession(undefined, activeConversationDraft()))
  let createdSessionId: string | null = null
  let sendStarted = false
  try {
    const session = await createSession()
    if (!session) throw new Error('Could not create a chat for this message')
    createdSessionId = session.id
    args.clearAttachments(args.submittedAttachmentIds)
    sendStarted = true
    const sending = sendChatMessage(session.id, args.text, {
      bindings: args.messageBindings.length > 0 ? args.messageBindings : undefined,
      isInternal: args.isInternal,
    })
    // Pinned-to-bottom is part of the paint, not the RPC's settle.
    args.forceScrollToBottom()
    // Stamp the URL with the session that actually received the send, so
    // the URL sync cannot navigate away to a different draft afterwards.
    args.goToSession(session.id, { project: session.projectId ?? undefined })
    await sending
  } catch (err) {
    // sendChatMessage owns the accepted-session toast + optimistic rollback. A failure
    // before it starts is the distinct create-session case and still needs a notice.
    if (!sendStarted) {
      const failure = sendFailure(err)
      toast.error(failure.message, { description: failure.detail })
    }
    if (args.isInternal) return
    if (createdSessionId) restoreFailedSendDraft(createdSessionId, args.text, args.messageBindings)
    else args.setPrompt((current) => (current.trim() ? current : args.text))
  }
}

/** A delayed preflight/send may settle after the user has started another draft. */
export function clearSubmittedPrompt(current: string, submitted: string): string {
  return current === submitted ? '' : current
}

/**
 * Builds the composer's send handler — handles the client-side `/fork` control
 * command and the immediate-send path. Extracted from ChatSurface.
 */
export function useSendMessage({
  createSession,
  prompt,
  setPrompt,
  attachments,
  clearAttachments,
  activeSessionId,
  agentRuntime,
  agentOpts,
  forkSession,
  forceScrollToBottom,
  goToSession,
}: SendMessageDeps): SendMessage {
  return useCallback<SendMessage>(
    (textOverride, bindings, isInternal) => {
      const wire = attachments.map((a) => a.attachment)
      const submittedAttachmentIds = attachments.map((attachment) => attachment.id)
      const messageBindings: MessageBinding[] = [...wire, ...(bindings ?? [])]
      // textOverride carries the prompt AFTER the composer's budget preflight;
      // @-references are NOT expanded into the prompt — they ride as context bindings and the
      // server resolves them into model-only binding contributions (quiet linking). A
      // binding-only send arrives with an EMPTY composer prompt but a non-empty
      // override (the refs' raw tokens), so the guard checks the effective text.
      const text = textOverride ?? prompt
      if (!text.trim() && messageBindings.length === 0) return

      // Client-side control command: /fork duplicates the session and navigates
      // to the copy — it never goes through the agent send pipeline.
      if (wire.length === 0 && text.trim().toLowerCase() === '/fork') {
        setPrompt((current) => clearSubmittedPrompt(current, prompt))
        clearAttachments(submittedAttachmentIds)
        forkSession()
        return
      }

      // Record in the global, cross-session composer history (ArrowUp recall).
      if (!isInternal) appendPromptHistory(text)

      setPrompt((current) => clearSubmittedPrompt(current, prompt))

      // No active session (home landing or a freshly-opened empty project): create
      // one lazily in the current scope, then send straight to it. This is the only
      // implicit creation — sessions are otherwise born only via the explicit "New
      // chat" buttons. The agentRuntime closure is still bound to the old (null)
      // session this tick, so drive the send through the store + backend directly.
      // JOIN the URL sync's draft minting instead of racing it: the active-draft strategy
      // allows reuse, and createSession's per-scope latch folds a creation already in flight.
      // A forced-fresh sibling used to swallow the message
      // while goReplace flipped the workspace to the never-sent-to draft.
      if (!activeSessionId) {
        void sendToNewChat({
          createSession,
          text,
          messageBindings,
          isInternal,
          submittedAttachmentIds,
          clearAttachments,
          setPrompt,
          forceScrollToBottom,
          goToSession,
        })
        return
      }

      // Always send immediately. If a run is active the BACKEND queues it (with
      // priority over loop/plugin wakes) and surfaces session_queue.updated; the
      // queue therefore survives a page reload. Pin to the bottom so the answer
      // streams into view (plain stick-to-bottom — no smart runway).
      // Put the text BACK on failure rather than discarding the rejection: the
      // composer cleared on Enter, so a failed send would otherwise destroy what
      // the user typed. agentRuntime.sendMessage already toasts and cleans state.
      clearAttachments(submittedAttachmentIds)
      void agentRuntime
        .sendMessage(
          text,
          agentOpts,
          messageBindings.length > 0 ? messageBindings : undefined,
          isInternal,
        )
        .catch(() => {
          // `activeSessionId` is this composer's own chat (non-null on this path).
          if (!isInternal) restoreFailedSendDraft(activeSessionId, text, messageBindings)
        })
      forceScrollToBottom()
    },
    [
      createSession,
      prompt,
      setPrompt,
      attachments,
      clearAttachments,
      activeSessionId,
      agentRuntime,
      agentOpts,
      forkSession,
      forceScrollToBottom,
      goToSession,
    ],
  )
}
