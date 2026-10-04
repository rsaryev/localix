import type { ToolSurface } from '@localixai/agent/agents'
import { USER_PARTICIPANT } from '../../../db'
import { ApiError } from '../../../lib/errors'
import type { MessageBinding, MessageMutationResponse, WakeSource } from '../contracts'
import { setMessageReaction } from '../runtime/run/message-reactions'
import { setMessagePinned } from './message-pins'
import { setMessageTask } from './message-tasks'
import { publishSessionUsageSnapshot } from '../runtime/session-usage'
import { recordAuxCallUsage } from '../runtime/usage-normalize'
import * as branchingOps from './branching-ops'
import { forkSession as forkSessionOp } from './session-fork'
import type { ChatServiceDeps } from './context'
import { improvePrompt as improvePromptOp } from './improve-prompt'
import type { OperationContexts } from './operation-contexts'
import { reactionRecipient, reactionWakePrompt } from './reaction-wake'
import type { ChatServiceGraph } from './service-graph'
import type { SessionCore } from './session-core'
import * as turnEntry from './turn-entry'

/**
 * What a person does TO the conversation: send, regenerate, edit, roll back, react, move between
 * branches, fork, have a prompt improved.
 *
 * Each one writes the message tree (or, for improve, bills a model call against the session),
 * and each goes through the one owner of its rule — `turn-entry.ts` for a send, `branching-ops.ts`
 * for the tree — so this module only binds those owners to the contexts they run in.
 */
export interface ChatMessageFacadeDeps extends Pick<
  ChatServiceGraph,
  'repo' | 'usageRepo' | 'streamRegistry' | 'now'
> {
  deps: ChatServiceDeps
  requireSession: SessionCore['requireSession']
  turnEntryCtx: OperationContexts['turnEntryCtx']
  branchingCtx: OperationContexts['branchingCtx']
  wakes: OperationContexts['wakes']
  /**
   * The active branch moved (edit, rollback, switch, checkout): whatever it left behind is no
   * longer the conversation. Told the moment the move STARTED, so what a run the move itself
   * started has asked since is not mistaken for something left behind.
   */
  onBranchMoved?: (userId: string, sessionId: string, since: string) => Promise<void>
}

export function createChatMessageFacade({
  deps,
  repo,
  usageRepo,
  streamRegistry,
  now,
  requireSession,
  turnEntryCtx,
  branchingCtx,
  wakes,
  onBranchMoved,
}: ChatMessageFacadeDeps) {
  const branchMoved = async <T>(userId: string, sessionId: string, move: Promise<T>) => {
    const since = now()
    const result = await move
    // Best-effort: the move happened; a stale open question is a cosmetic leftover, not a reason
    // to fail it.
    await onBranchMoved?.(userId, sessionId, since).catch((error: unknown) =>
      console.warn('[chat] reconciling questions after a branch move failed', error),
    )
    return result
  }
  return {
    /**
     * The user's own turn entry: the slash-command chain (control → plugin →
     * skill), quiet @-ref expansion, then run-or-queue. See turn-entry.ts.
     */
    sendMessage(
      userId: string,
      sessionId: string,
      prompt: string,
      bindings?: MessageBinding[],
      /** Provenance of a non-frontend send (e.g. `'external'` for an inbound
       * webhook). Stamped on the persisted user row so the source is
       * distinguishable downstream; the frontend omits it (→ a plain user turn). */
      origin?: WakeSource,
      /** Client-requested transcript hiding — a machine-composed prompt (analysis wizard). */
      isInternal?: boolean,
      /** Capabilities of the client/runtime surface initiating this turn. */
      toolSurface?: ToolSurface,
      /** Originating optimistic UI row for exact busy-queue reconciliation. */
      clientMessageId?: string,
    ): Promise<MessageMutationResponse> {
      return turnEntry.sendMessage(
        turnEntryCtx,
        userId,
        sessionId,
        prompt,
        bindings,
        origin,
        isInternal,
        toolSurface,
        clientMessageId,
      )
    },

    async regenerate(
      userId: string,
      sessionId: string,
      toolSurface?: ToolSurface,
      expectedMessageId?: string,
    ): Promise<MessageMutationResponse> {
      return branchingOps.regenerate(
        branchingCtx,
        userId,
        sessionId,
        toolSurface,
        expectedMessageId,
      )
    },

    /**
     * Fork from any past user message: edit its text and branch. The original
     * message and everything after it stay in the tree as an alternative branch
     * (reachable via the message's branch switcher); a NEW user message with the
     * edited text is appended as a sibling and the agent runs from there.
     */
    async editMessage(
      userId: string,
      sessionId: string,
      messageId: string,
      content: string,
      toolSurface?: ToolSurface,
    ): Promise<MessageMutationResponse> {
      return branchMoved(
        userId,
        sessionId,
        branchingOps.editMessage(branchingCtx, userId, sessionId, messageId, content, toolSurface),
      )
    },

    async rollback(userId: string, sessionId: string, messageId: string) {
      return branchMoved(
        userId,
        sessionId,
        branchingOps.rollback(branchingCtx, userId, sessionId, messageId),
      )
    },

    /** Toggle the person's own mark on a message. */
    async reactToMessage(userId: string, sessionId: string, messageId: string, emoji: string) {
      await requireSession(userId, sessionId)
      const message = await repo.getMessage(userId, sessionId, messageId)
      if (!message) throw new ApiError(404, 'message_not_found', 'Message not found')
      const mine = (message.payload.reactions ?? []).some(
        (r) => r.from === USER_PARTICIPANT && r.emoji === emoji,
      )
      const changed = await setMessageReaction(
        { repo, streamRegistry, now },
        { userId, sessionId, messageId, from: USER_PARTICIPANT, emoji, remove: mine },
      )
      // A mark ASKS FOR A TURN, the way a typed line does — otherwise it is decoration the
      // agent learns about only if it happens to speak again. Taking one back does not: that
      // is a correction to a signal already delivered, and re-waking on it would make an
      // undo cost a turn. Wake priority, so a typed message always goes first, and the queue
      // coalesces a burst of marks into one turn.
      // The reaction itself is already saved, so a wake that does not land must not fail
      // the request — but it must not vanish either, or the mark silently never asks.
      if (changed && !mine) {
        const to = reactionRecipient(message.payload)
        wakes.send(
          {
            userId,
            sessionId,
            content: reactionWakePrompt(emoji, message.payload),
            source: 'reaction',
            ...(to ? { to } : {}),
          },
          `reaction on message ${messageId}`,
        )
      }
      return { ok: true as const, reacted: !mine }
    },

    /** Pin or unpin a message — keeps it in the model's view (see `message-pins.ts`). */
    async pinMessage(userId: string, sessionId: string, messageId: string, pinned: boolean) {
      await requireSession(userId, sessionId)
      const message = await repo.getMessage(userId, sessionId, messageId)
      if (!message) throw new ApiError(404, 'message_not_found', 'Message not found')
      await setMessagePinned(
        { repo, streamRegistry, now },
        { userId, sessionId, messageId, pinned },
      )
      return { ok: true as const, pinned }
    },

    /** Tick or clear one box of a reply's checklist — the reader's mark (`message-tasks.ts`). */
    async checkMessageTask(
      userId: string,
      sessionId: string,
      messageId: string,
      key: string,
      checked: boolean,
    ) {
      await requireSession(userId, sessionId)
      const message = await repo.getMessage(userId, sessionId, messageId)
      if (!message) throw new ApiError(404, 'message_not_found', 'Message not found')
      await setMessageTask(
        { repo, streamRegistry, now },
        { userId, sessionId, messageId, key, checked },
      )
      return { ok: true as const, checked }
    },

    async switchBranch(userId: string, sessionId: string, messageId: string, branchIndex: number) {
      return branchMoved(
        userId,
        sessionId,
        branchingOps.switchBranch(branchingCtx, userId, sessionId, messageId, branchIndex),
      )
    },

    /** Full message tree (all branches) + active path, for the branch-tree UI. */
    async getBranchTree(userId: string, sessionId: string) {
      return branchingOps.getBranchTree(branchingCtx, userId, sessionId)
    },

    /**
     * Copy a conversation into a brand-new chat session. See
     * session-fork.ts for the full contract.
     */
    async forkSession(userId: string, sessionId: string, fromMessageId?: string) {
      return forkSessionOp(branchingCtx, userId, sessionId, fromMessageId)
    },

    /**
     * Jump the active branch to ANY message in the tree (not just a sibling of
     * the currently shown one): the leaf moves to the deepest descendant of the
     * target, so listMessages returns that whole branch.
     */
    async checkoutBranch(userId: string, sessionId: string, messageId: string) {
      return branchMoved(
        userId,
        sessionId,
        branchingOps.checkoutBranch(branchingCtx, userId, sessionId, messageId),
      )
    },

    improvePrompt(userId: string, sessionId: string, prompt: string): Promise<{ prompt: string }> {
      return improvePromptOp(
        {
          deps,
          requireSession,
          recordUsage: (e) =>
            recordAuxCallUsage({
              usageRepo,
              kind: 'improve',
              ...e,
              onRecorded: () =>
                publishSessionUsageSnapshot({
                  repo,
                  usageRepo,
                  streamRegistry,
                  userId: e.userId,
                  sessionId: e.sessionId,
                }),
            }),
        },
        userId,
        sessionId,
        prompt,
      )
    },
  }
}
