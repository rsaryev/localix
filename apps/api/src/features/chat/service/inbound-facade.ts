import type { MessageMutationResponse, SessionDetail, WakeRequest } from '../contracts'
import * as turnEntry from './turn-entry'
import * as subagentMessages from './subagent-messages'
import * as subagentClose from './subagent-close'
import type { DelegationPriority } from '../../agent-core/delegation-lanes'
import * as threadOps from './thread-ops'
import type { createAuxProviderHelpers } from './aux-provider'
import type { MessageAttachment } from '../contracts'
import type { SessionRecord } from '../repository'
import * as externalSessions from './external-sessions'
import type {
  ExternalSessionInput,
  ExternalSessionsContext,
  ExternalTurnResult,
} from './external-sessions'

/**
 * Turns that ARRIVE rather than being typed: a wake, a monitor's event, a thread reply, a message
 * from a channel.
 *
 * What they share is the hard part — every one of them has to decide whether the session can take
 * a turn right now, and say so. A wake that lands on a running session, two monitor events in the
 * same instant, a channel message racing the reply it triggered: each is answered here rather than at the door it
 * came through, because the answer is about the session and not about the door. That is also why
 * the wake methods return a delivery result: their callers are fire-and-forget by design, so this
 * is the only place a dropped wake can be seen.
 */
export interface ChatInboundFacadeDeps {
  /** The run's model, resolved per wake so a provider change mid-session is honoured. */
  buildLanguageModel: ReturnType<typeof createAuxProviderHelpers>['buildLanguageModel']
  turnEntryCtx: turnEntry.TurnEntryContext
  threadOpsCtx: threadOps.ThreadOpsContext
  externalSessionsCtx: ExternalSessionsContext
}

export function createChatInboundFacade({
  buildLanguageModel,
  turnEntryCtx,
  threadOpsCtx,
  externalSessionsCtx,
}: ChatInboundFacadeDeps) {
  return {
    /**
     * Push an internal message into a CHAT session and run it — how a producer that is not
     * the person (a loop, a finished child, a plugin) starts a turn. No-op if the session is
     * gone or isn't a chat session.
     *
     * Answers whether the wake landed ({@link turnEntry.WakeDelivery}). Callers are
     * fire-and-forget by design, so this is the only way a dropped wake can be seen.
     */
    wakeSession(request: WakeRequest): Promise<turnEntry.WakeDelivery> {
      return turnEntry.wakeSession(turnEntryCtx, request)
    },

    /** Scheduler-facing wake that resolves with the agent run outcome. */
    wakeSessionAndWait(request: WakeRequest) {
      return turnEntry.wakeSessionAndWait(turnEntryCtx, request)
    },

    /** A delegator's message to its child, running or not — see `subagent-messages.ts`. */
    messageSubagent(
      userId: string,
      sessionId: string,
      content: string,
      priority?: DelegationPriority,
      interrupt?: boolean,
    ) {
      return subagentMessages.messageSubagent(
        turnEntryCtx,
        userId,
        sessionId,
        content,
        priority,
        interrupt,
      )
    },

    /** After a child's run: start the next one for messages no run took. */
    flushChildMessages(userId: string, sessionId: string) {
      return subagentMessages.flushWaitingMessages(turnEntryCtx, userId, sessionId)
    },

    /** Close a delegated child for good — see `subagent-close.ts`. */
    closeSubagent(userId: string, sessionId: string) {
      return subagentClose.closeSubagent(turnEntryCtx, userId, sessionId)
    },

    buildLanguageModel,

    /**
     * Internal entry point for engine-dispatched job sessions (delegated task runs,
     * delegate sub-agents, recurring tasks). sendMessage() rejects non-chat
     * sessions, so the engine starts agent runs through this path instead.
     */
    runJobTask(
      userId: string,
      sessionId: string,
      task: string,
      opts: turnEntry.RunJobTaskOptions,
    ): Promise<MessageMutationResponse> {
      return turnEntry.runJobTask(turnEntryCtx, userId, sessionId, task, opts)
    },

    openMessageThread(
      userId: string,
      sessionId: string,
      messageId: string,
    ): Promise<SessionDetail> {
      return threadOps.openMessageThread(threadOpsCtx, userId, sessionId, messageId)
    },

    /**
     * Entry point for plugin CHANNELS (external chat platforms — see
     * plugins/channel-host.ts): routes an external platform message into a
     * persistent chat session and resolves with the agent's final reply text.
     *
     * Each (plugin, channel, conversation) maps to ONE session, keyed via
     * sourceToolCallId — follow-ups continue the same conversation, and the
     * session is a normal chat the user can open and continue in the workspace.
     */
    handleChannelInbound(
      userId: string,
      input: externalSessions.ChannelInboundInput,
    ): Promise<externalSessions.ChannelInboundResult> {
      return externalSessions.handleChannelInbound(externalSessionsCtx, userId, input)
    },

    resolveExternalSession(
      userId: string,
      input: ExternalSessionInput,
    ): Promise<{ session: SessionRecord; created: boolean }> {
      return externalSessions.resolveExternalSession(externalSessionsCtx, userId, input)
    },

    runExternalTurn(
      userId: string,
      sessionId: string,
      text: string,
      inboundAttachments?: MessageAttachment[],
    ): Promise<ExternalTurnResult> {
      return externalSessions.runExternalTurn(
        externalSessionsCtx,
        userId,
        sessionId,
        text,
        inboundAttachments,
      )
    },
  }
}
