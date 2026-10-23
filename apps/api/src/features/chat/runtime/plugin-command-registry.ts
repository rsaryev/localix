/**
 * Plugin command registry — the GENERIC server→UI→server round-trip behind
 * `ToolSessionContext.emitCommandWithReply`. A machine-resolved twin of the
 * preview relay (`preview-command-registry.ts`), but for the typed
 * `plugin.command` frame: `send()` publishes the frame over the session firehose
 * and parks a Promise keyed by its `commandId`; the plugin's client sink executes
 * the command and replies via the `{t:'plugin-command-result'}` WS RPC, which
 * calls `resolve()` to settle that Promise. `commandId` was minted onto every
 * frame in phase 2.1 exactly so it could be this correlation key.
 *
 * Lives here (the chat runtime, which owns `streamRegistry`) and is handed to the
 * agent loop as the injected `MiniAppCommandControl` capability — so plugin tools
 * see only the narrow `emitCommandWithReply` seam and core stays plugin-agnostic.
 */

import { randomUUID } from 'node:crypto'

import type { SessionStreamRegistry } from './session-stream-registry'
import { isInteractAllowedForOwner } from './interact-ownership'
import { createPendingReplyRegistry, type ReplyScheduler } from './pending-reply-registry'

/** Reply payload from the client sink (carried by the `plugin-command-result` WS RPC). */
export interface MiniAppCommandResultPayload {
  ok: boolean
  /** Opaque to core — the plugin's two ends share the shape. */
  result?: unknown
  error?: string
}

/** How one awaited command ended. `noReply` = no client answered (not a defect). */
export type MiniAppCommandOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string; noReply?: boolean }

export interface MiniAppCommandSendInput {
  userId: string
  sessionId: string
  plugin: string
  channel: string
  payload: unknown
  /** Ordering aid for the frame (the caller owns the per-run counter). */
  seq: number
  timeoutMs?: number
}

/** The narrow capability the agent loop injects (see RunnerDeps.pluginCommands). */
export interface MiniAppCommandControl {
  send(input: MiniAppCommandSendInput): Promise<MiniAppCommandOutcome>
}

export interface MiniAppCommandRegistry extends MiniAppCommandControl {
  /** Settle a pending command from the client's reply. false → unknown id / owner mismatch. */
  resolve(commandId: string, payload: MiniAppCommandResultPayload, callerUserId?: string): boolean
  /** Reject every pending command for a (user, session) — e.g. the session was closed. */
  closeForSession(userId: string, sessionId: string): void
}

// Plugin sinks answer synchronously from client-side state (no probe handshake,
// no media prompts — unlike the preview relay's 22s), so the ceiling only covers
// WS latency + a lazy-loaded plugin chunk. A closed tab / offline client simply
// never answers and this window is the whole wait.
const DEFAULT_TIMEOUT_MS = 10_000

const NO_REPLY_MESSAGE =
  'No reply from the UI — the target surface may be closed, or no client is connected ' +
  '(e.g. an unattended run). Treat this as "could not read it", NOT as a defect or as ' +
  'confirmation of any state.'

interface PendingMeta {
  userId: string
  sessionId: string
}

export function createMiniAppCommandRegistry(deps: {
  streamRegistry: SessionStreamRegistry
  timeoutMs?: number
  /** Timer seam for deterministic lifecycle tests. */
  scheduler?: ReplyScheduler
}): MiniAppCommandRegistry {
  const replies = createPendingReplyRegistry<MiniAppCommandOutcome, PendingMeta>(deps.scheduler)
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    send({ userId, sessionId, plugin, channel, payload, seq, timeoutMs: perCallTimeoutMs }) {
      const commandId = `plc_${randomUUID()}`
      const wait = perCallTimeoutMs ?? timeoutMs
      return replies.request({
        id: commandId,
        meta: { userId, sessionId },
        timeoutMs: wait,
        onTimeout: () => ({ ok: false, noReply: true, error: NO_REPLY_MESSAGE }),
        onPublishError: (error) => ({
          ok: false,
          error: `Failed to send the plugin command to the UI: ${error instanceof Error ? error.message : String(error)}`,
        }),
        publish: () => {
          deps.streamRegistry.publish(userId, sessionId, {
            type: 'plugin.command',
            sessionId,
            plugin,
            channel,
            payload,
            commandId,
            seq,
          })
        },
      })
    },

    resolve(commandId, payload, callerUserId) {
      const outcome: MiniAppCommandOutcome = payload.ok
        ? { ok: true, result: payload.result }
        : { ok: false, error: payload.error ?? 'The plugin UI reported a failure.' }
      return replies.resolve(
        commandId,
        (meta) => isInteractAllowedForOwner(meta.userId, callerUserId),
        outcome,
      )
    },

    closeForSession(userId, sessionId) {
      replies.closeWhere((meta) => meta.userId === userId && meta.sessionId === sessionId, {
        ok: false,
        noReply: true,
        error: 'The session was closed before the UI replied.',
      })
    },
  }
}
