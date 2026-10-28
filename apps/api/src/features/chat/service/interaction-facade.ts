import { resolveDefaultUserId } from '../../../lib/env'
import type { VaultItemType } from '../../secrets/contracts'
import { isInteractAllowedForOwner } from '../runtime/interact-ownership'
import type { MiniAppCommandResultPayload } from '../runtime/mini-app-command-registry'
import type { PreviewResultPayload } from '../runtime/preview-command-registry'
import type { ChatServiceDeps } from './context'
import type { ChatServiceGraph } from './service-graph'

/**
 * The answers a client sends BACK to something the runtime is waiting on: a HITL card, a secret
 * prompt, a running tool's action button, a relayed preview or mini app command, an "Always allow"
 * grant being taken back.
 *
 * Grouped because every one of them settles a pending request owned by someone, and the defect
 * each has to stop is the same: a caller that is not that owner settling it. So each checks the
 * owner recorded on the PENDING entry (never one looked up elsewhere) before it resolves anything.
 */
export interface ChatInteractionFacadeDeps extends Pick<
  ChatServiceGraph,
  'runner' | 'hitlRegistry' | 'streamRegistry' | 'previewRegistry' | 'miniAppCommands'
> {
  deps: ChatServiceDeps
}

export function createChatInteractionFacade({
  deps,
  runner,
  hitlRegistry,
  streamRegistry,
  previewRegistry,
  miniAppCommands,
}: ChatInteractionFacadeDeps) {
  return {
    /** Internal ownership bridge for channel-side HITL controls. */
    getPendingInteractionSessionId(requestId: string): string | null {
      return hitlRegistry.getRequestMeta(requestId)?.sessionId ?? null
    },

    interact(
      toolCallId: string,
      action: string,
      payload?: unknown,
      callerUserId?: string,
    ): { ok: boolean; error?: string } {
      // HITL actions — toolCallId == requestId for ask/quiz tools. Capture the
      // request meta BEFORE respond/dismiss deletes it, so we can publish a
      // `hitl.resolved` event that clears the overlay on every client immediately.
      if (action === 'respond' || action === 'dismiss') {
        const meta = hitlRegistry.getRequestMeta(toolCallId)
        try {
          if (action === 'respond') {
            // A request_secret prompt may ONLY resolve through `submitSecret` — the leg that
            // actually writes the vault. Accepting a generic respond here would let a same-owner
            // client mint `stored: true` with nothing stored, and the agent would then hand out a
            // `secret:KEY` reference that resolves to nothing (or to an older value). Dismiss
            // stays allowed: the UI's Escape routes through it, and a dismissal carries no claim.
            const pending = hitlRegistry.controller.getPending(toolCallId)
            if (pending?.request.kind === 'request_secret') {
              return { ok: false, error: 'secret_request_not_active' }
            }
            const answers = (payload as Record<string, unknown> | undefined)?.answers
            hitlRegistry.respond(toolCallId, answers, callerUserId)
          } else {
            hitlRegistry.dismiss(toolCallId, callerUserId)
          }
          if (meta) {
            streamRegistry.publish(meta.userId ?? resolveDefaultUserId(), meta.sessionId, {
              type: 'hitl.resolved',
              sessionId: meta.sessionId,
              requestId: toolCallId,
              reason: action === 'respond' ? 'answered' : 'dismissed',
            })
          }
          return { ok: true }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : 'HITL request not active',
          }
        }
      }
      // Process/tool actions (kill, pause, custom…)
      const executed = runner.executeToolAction(toolCallId, action, payload, callerUserId)
      return executed
        ? { ok: true }
        : { ok: false, error: 'Action not found or tool is no longer running' }
    },

    /**
     * The isolated ANSWER leg of the `request_secret` HITL request kind, which the
     * `Vault` tool raises from its create/rotate actions. The typed VALUE
     * arrives here over the dedicated `submit-secret` WS command — deliberately NOT
     * `interact`, so the shared respond path (controller records, mini app hooks, any
     * future interact logging) can never capture it. The value is written straight
     * to the encrypted vault and DISCARDED: the paused tool resumes with only
     * `{ stored }`. Keep the value out of respond payloads, stream events, error
     * messages, and logs — the agent must never see it.
     */
    async submitSecret(
      requestId: string,
      value: string,
      callerUserId?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      const meta = hitlRegistry.getRequestMeta(requestId)
      const pending = hitlRegistry.controller.getPending(requestId)
      // One opaque refusal for unknown / foreign / not-a-secret-prompt — mirrors the
      // respond gate's "not active" (never leaks that the request exists). `meta` is REQUIRED,
      // not merely consulted: without it the owner is unknown, and a vault write under the
      // caller's own id would let a guessed toolCallId store a secret for the wrong user. The
      // tool tracks meta before it awaits, so a legitimate prompt always has it.
      if (
        !meta ||
        pending?.request.kind !== 'request_secret' ||
        !isInteractAllowedForOwner(meta.userId, callerUserId)
      ) {
        return { ok: false, error: 'secret_request_not_active' }
      }
      if (!deps.storeSecret) {
        return { ok: false, error: 'secret_storage_unavailable' }
      }
      const request = pending.request.payload as {
        action: 'create' | 'rotate'
        key: string
        reason: string
        type: VaultItemType
        label?: string
        description?: string
        tags: string[]
        expectedVersion?: number
      }
      // Vault owner = the run's user (meta), not the socket's: the run resolves
      // `${secret:KEY}` under its own userId. The ownership gate above already
      // guarantees the two agree whenever both are present.
      const ownerId = meta.userId ?? resolveDefaultUserId()
      // Order: check-active → vault → respond. If the run settles between the vault
      // write and respond, worst case the value is safely stored while the tool
      // returns a clean "not provided" — never the reverse.
      const result = await deps.storeSecret(ownerId, request, value)
      try {
        hitlRegistry.respond(
          requestId,
          { stored: result.stored, outcome: result.outcome },
          callerUserId,
        )
      } catch {
        return { ok: false, error: 'secret_request_not_active' }
      }
      streamRegistry.publish(ownerId, meta.sessionId, {
        type: 'hitl.resolved',
        sessionId: meta.sessionId,
        requestId,
        reason: 'answered',
      })
      return { ok: true }
    },

    /**
     * Revoke a session's "Always allow" grant relayed over the
     * `{t:'session.revoke-permission'}` WS RPC: drop one tool (by name) or clear the
     * whole set (omit toolName) so it re-prompts on its next call. Ownership-gated
     * inside the runner. Returns the remaining set, or null when not owned.
     */
    revokeSessionPermission(
      userId: string,
      sessionId: string,
      toolName?: string,
    ): Promise<string[] | null> {
      return runner.revokeSessionAutoApproval(userId, sessionId, toolName)
    },

    /**
     * Settle a pending `Browser` tool command from the host UI's reply (the
     * `{t:'preview-result'}` WS RPC). Ownership-gated by the command's owner.
     */
    resolvePreviewCommand(
      commandId: string,
      payload: PreviewResultPayload,
      callerUserId?: string,
    ): { ok: boolean } {
      return { ok: previewRegistry.resolve(commandId, payload, callerUserId) }
    },

    /**
     * Settle a pending awaited mini app command (`emitCommandWithReply`) from the
     * client sink's reply (the `{t:'mini-app-command-result'}` WS RPC).
     * Ownership-gated by the command's owner.
     */
    resolveMiniAppCommand(
      commandId: string,
      payload: MiniAppCommandResultPayload,
      callerUserId?: string,
    ): { ok: boolean } {
      return { ok: miniAppCommands.resolve(commandId, payload, callerUserId) }
    },
  }
}
