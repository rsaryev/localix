/**
 * Preview command registry — the server→host→probe relay that powers the
 * `Browser` tool. A machine-resolved twin of the HITL registry
 * (`hitl-registry.ts`): `send()` publishes a `preview.command` over the session
 * firehose and parks a Promise keyed by `commandId`; the open inspector's probe
 * executes it and the UI replies via the `{t:'preview-result'}` WS RPC, which
 * calls `resolve()` to settle that Promise.
 *
 * Lives here (the chat runtime, which owns `streamRegistry`) and is handed to the
 * tool as the injected `PreviewControl` capability — so agent-core stays unaware.
 */

import { randomUUID } from 'node:crypto'

import type { SessionStreamRegistry } from './session-stream-registry'
import type {
  PreviewCommandResult,
  PreviewControl,
  PreviewSendOutcome,
} from '../../agent-core/tools/preview/preview-control'
import { isInteractAllowedForOwner } from './interact-ownership'
import { createPendingReplyRegistry, type ReplyScheduler } from './pending-reply-registry'

/** Reply payload from the host UI (carried by the `preview-result` WS RPC). */
export interface PreviewResultPayload {
  /** Claim before driving: only one connected host may execute a broadcast command. */
  claim?: boolean
  /** Relinquish an unexecuted claim during a host handoff without settling the command. */
  release?: boolean
  hostId?: string
  ok: boolean
  result?: PreviewCommandResult
  error?: string
  errorCode?:
    | 'not_found'
    | 'intercepted'
    | 'bad_request'
    | 'failed'
    | 'app_disconnected'
    | 'host_unavailable'
    | 'probe_not_ready'
    | 'timeout'
    | 'frame_blocked'
  /** No probe was connected (preview tab closed/not engaged). */
  notEngaged?: boolean
}

// If no client replies within this window, no preview is actually open + engaged.
// Generous: the host may auto-engage the injecting proxy (external dev servers),
// wait ~8s for the probe to handshake, then run the command (own ~10s cap) — and a
// screenshot grab can wait on a one-time getDisplayMedia prompt. Must exceed the
// host's worst-case (engage-wait + command) so a slow-but-coming reply isn't preempted.
const DEFAULT_TIMEOUT_MS = 22_000

interface PendingMeta {
  userId: string
  sessionId: string
}

export interface PreviewCommandRegistry extends PreviewControl {
  /** Settle a pending command from the host's reply. false → unknown id / owner mismatch. */
  resolve(commandId: string, payload: PreviewResultPayload, callerUserId?: string): boolean
  /** Reject every pending command for a (user, session) — e.g. the session was closed. */
  closeForSession(userId: string, sessionId: string): void
}

const NOT_ENGAGED_MESSAGE =
  'The connected Localix application did not complete this Browser command. Check that the tab ID is still open and the page is reachable. Do not retry interactions blindly: a timed-out action may have run. Record required visual or interaction checks as blocked; a build or HTTP response does not replace them.'

export function createPreviewCommandRegistry(deps: {
  streamRegistry: SessionStreamRegistry
  timeoutMs?: number
  /** Timer seam for deterministic lifecycle tests. */
  scheduler?: ReplyScheduler
}): PreviewCommandRegistry {
  const replies = createPendingReplyRegistry<PreviewSendOutcome, PendingMeta>(deps.scheduler)
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // `publish` re-sends the command frame. A release needs it: see the release branch below.
  const claims = new Map<string, { userId: string; hostId?: string; publish: () => void }>()
  const queues = new Map<string, Promise<unknown>>()
  const queued = new Set<{ userId: string; sessionId: string; cancelled: boolean }>()

  return {
    send({ userId, sessionId, command, timeoutMs: perCallTimeoutMs }) {
      if (!(deps.streamRegistry.hasConnectedClient?.(userId) ?? true))
        return Promise.resolve({
          ok: false as const,
          errorCode: 'app_disconnected' as const,
          error:
            'Localix is not connected. Open the desktop application to control this Browser tab.',
        })
      const key = `${userId}:${command.previewId ?? sessionId}`
      const entry = { userId, sessionId, cancelled: false }
      queued.add(entry)
      const run = async (): Promise<PreviewSendOutcome> => {
        if (entry.cancelled)
          return {
            ok: false,
            errorCode: 'host_unavailable',
            error: 'The session closed before this queued command could run.',
          }
        const commandId = `pc_${randomUUID()}`
        const publish = () =>
          deps.streamRegistry.publish(userId, sessionId, {
            type: 'preview.command',
            sessionId,
            commandId,
            command,
          })
        claims.set(commandId, { userId, publish })
        // A per-call override lets a BEST-EFFORT relay (the snapshot folded into an
        // `open` result) bail out fast when no probe is attached, instead of freezing
        // for the full default window on an unattended/headless run.
        const wait = perCallTimeoutMs ?? timeoutMs
        return replies
          .request({
            id: commandId,
            meta: { userId, sessionId },
            timeoutMs: wait,
            onTimeout: () => ({
              ok: false,
              notEngaged: true,
              errorCode: claims.get(commandId)?.hostId ? 'timeout' : 'host_unavailable',
              error: NOT_ENGAGED_MESSAGE,
            }),
            onPublishError: (error) => ({
              ok: false,
              error: `Failed to send the Browser command to the UI: ${error instanceof Error ? error.message : String(error)}`,
              errorCode: 'failed',
            }),
            publish,
          })
          .finally(() => claims.delete(commandId))
      }
      // Previews of one origin share browser storage. Serialize commands across their hosts.
      const previous = queues.get(key)
      const pending = previous ? previous.then(run, run) : run()
      queues.set(key, pending)
      void pending
        .finally(() => {
          queued.delete(entry)
          if (queues.get(key) === pending) queues.delete(key)
        })
        .catch(() => {})
      return pending
    },

    resolve(commandId, payload, callerUserId) {
      const claim = claims.get(commandId)
      if (!claim || !isInteractAllowedForOwner(claim.userId, callerUserId)) return false
      if (payload.release) {
        if (!payload.hostId || claim.hostId !== payload.hostId) return false
        claim.hostId = undefined
        // A handoff releases AFTER the replacement host has already tried: the visible tab
        // mounts, sees the command and claims while the hidden host still holds it, so its
        // claim is refused and it drops the command. Re-publishing is the only way that host
        // learns the command is free again; without it the command times out unclaimed as
        // host_unavailable. A duplicate frame is harmless: only one claim can win.
        try {
          claim.publish()
        } catch {
          /* The pending timeout still settles the command if the frame cannot be sent. */
        }
        return true
      }
      if (payload.claim) {
        if (!payload.hostId || claim.hostId) return false
        claim.hostId = payload.hostId
        return true
      }
      if (claim.hostId && payload.hostId !== claim.hostId) return false
      const outcome: PreviewSendOutcome =
        payload.ok && payload.result
          ? { ok: true, result: payload.result }
          : {
              ok: false,
              error: payload.error ?? 'Browser command failed',
              errorCode: payload.errorCode,
              notEngaged: payload.notEngaged,
              // A failure may still carry a fresh snapshot the probe self-healed into
              // (stale ref / covered target) — pass it through so the tool can fold the
              // current refs into the same round-trip.
              ...(payload.result ? { result: payload.result } : {}),
            }
      return replies.resolve(
        commandId,
        (meta) => isInteractAllowedForOwner(meta.userId, callerUserId),
        outcome,
      )
    },

    closeForSession(userId, sessionId) {
      for (const entry of queued) {
        if (entry.userId === userId && entry.sessionId === sessionId) entry.cancelled = true
      }
      replies.closeWhere((meta) => meta.userId === userId && meta.sessionId === sessionId, {
        ok: false,
        notEngaged: true,
        error: 'The session was closed before the Browser tab replied.',
      })
    },
  }
}
