import { upgradeWebSocket, websocket } from 'hono/bun'

import type { Context } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppContext } from '../../app'
import { isApiError } from '../../lib/errors'
import type { Logger } from '../../lib/logger'
import {
  isLiveOnlyEvent,
  type SessionStreamRegistry,
  type StreamEnvelope,
} from '../chat/runtime/session-stream-registry'
import type { InboxChange } from '../notifications/contracts'
import type { AgentStreamEvent, MessageBinding } from '../chat/contracts'
import type { ToolSurface } from '@localixai/agent/agents'
import type { PreviewResultPayload } from '../chat/runtime/preview-command-registry'
import type { MiniAppCommandResultPayload } from '../chat/runtime/mini-app-command-registry'
import {
  parseRealtimeCommand,
  type InlineCompletionPayload,
  type PredictNextEditPayload,
} from './ws-commands'
import type { EditPrediction, NextEditResult } from '../edit-prediction/contracts'
import {
  createWsFrameConnection,
  type WsFrameConnection,
  type WsFrameRegistry,
} from '../ext/ws-frame-registry'
import { encodeSessionCursor, parseSessionCursor } from '../ext/ws-frame'
import { createLspChannel, type RealtimeLspService } from './ws-lsp'

// ONE WebSocket per browser tab carries EVERY live server→client event (chat
// session firehose, notifications, mini app streams), replacing the previous fleet of SSE
// EventSources. A browser allows only 6 concurrent HTTP/1.1 connections per
// origin SHARED ACROSS TABS, so each long-lived SSE burned a slot and a couple
// of tabs would exhaust the pool (the page itself then hung). WebSockets are
// tracked under a separate, far larger per-host budget and carry no per-frame
// HTTP overhead — so a single multiplexed socket is both unconstrained and
// cheaper. Bun auto-sends protocol pings (`sendPings` default), so no app-level
// keepalive is needed.
//
// `websocket` is the handler object Bun.serve needs; `upgradeWebSocket` mounts the
// Hono route. Imported directly from hono/bun (createBunWebSocket is deprecated).
export { websocket }

// Dependencies are passed as thunks so the route can be REGISTERED without
// eagerly resolving services (some test harnesses build the app with a partial
// dep set); the bus handles are only touched when a socket actually opens.
export interface RealtimeDeps {
  subscribeScoped: SessionStreamRegistry['subscribeScoped']
  /**
   * The user's notification journal, live. No replay ring: the journal is durable, so a client
   * subscribes first and then reads `GET /rpc/notifications?since=<cursor>` — anything committed
   * between the two arrives both ways and the client keeps the higher `seq`.
   */
  notificationsSubscribe?: (userId: string, listener: (change: InboxChange) => void) => () => void
  // Client→server commands (ride the same socket instead of an HTTP request).
  sendMessage: (
    userId: string,
    sessionId: string,
    prompt: string,
    bindings?: MessageBinding[],
    origin?: undefined,
    isInternal?: boolean,
    toolSurface?: ToolSurface,
    clientMessageId?: string,
  ) => Promise<unknown>
  stop: (sessionId: string, callerUserId?: string) => Promise<boolean>
  /** A window began or stopped rendering sessions (Claude Code mods' `session.attach`/`detach`). */
  onWatch?: (clientId: string, sessionIds: readonly string[], attached: boolean) => void
  interact: (
    toolCallId: string,
    action: string,
    payload?: unknown,
    callerUserId?: string,
  ) => { ok: boolean; error?: string }
  // The `request_secret` ANSWER leg: vault the typed value server-side and resume
  // the paused tool with only `{ stored }`. Replies (success AND failure) must
  // never echo the value. Optional so partial dep sets in tests still build.
  submitSecret?: (
    requestId: string,
    value: string,
    callerUserId?: string,
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
  // Settle a pending `Browser` tool command from the host probe's reply.
  previewResult?: (
    commandId: string,
    payload: PreviewResultPayload,
    callerUserId?: string,
  ) => { ok: boolean }
  // Settle a pending awaited mini app command (`emitCommandWithReply`) from the
  // client sink's reply. Optional so partial dep sets in tests still build.
  miniAppCommandResult?: (
    commandId: string,
    payload: MiniAppCommandResultPayload,
    callerUserId?: string,
  ) => { ok: boolean }
  // Inspector-editor ↔ language-server document sync (diagnostics ride back on the
  // firehose as `lsp.diagnostics`). Optional so partial dep sets in tests still build.
  lsp?: RealtimeLspService
  // Unified text-input completion — one aux call answering every requested
  // surface. Optional so partial dep sets in tests still build.
  completeInputs?: (
    userId: string,
    payload: InlineCompletionPayload,
    signal?: AbortSignal,
  ) => Promise<{ completions: Record<string, string>; outcome?: string; durationMs?: number }>
  // Next-edit prediction — a single next line-range edit for the open
  // file. Optional so partial dep sets in tests still build; absent → typed no-model result.
  predictNextEdit?: (
    userId: string,
    payload: PredictNextEditPayload,
    signal?: AbortSignal,
  ) => Promise<{
    protocolVersion?: 2
    requestId?: string
    documentVersion?: number
    documentDigest?: string
    contextFingerprint?: string
    outcome: NextEditResult['outcome']
    edits: EditPrediction[] | null
  }>
  // Revoke a session's "Always allow" grant (one tool, or all). Ownership-gated in
  // the service. Optional so partial dep sets in tests still build.
  revokeSessionPermission?: (
    userId: string,
    sessionId: string,
    toolName?: string,
  ) => Promise<string[] | null>
  // GENERIC live-stream contributions (backend subsystems / bundled mini apps). A
  // subsystem contributes a subscribe/unsubscribe command pair + a tagged frame
  // stream; ws.ts consults this registry for any command it does not otherwise
  // recognize. Optional so partial dep sets still build.
  wsFrames?: WsFrameRegistry
  logger: Logger
}

// Wire frames are newline-delimited text (cheap to build, reuses the registry's
// once-serialized event JSON without re-stringifying on the hot path):
//   session event: "s\n<boot-epoch>:<sequence>\n<sessionId>\n<event-json>"
//   notification:  "n\n<inbox-change-json>"   (features/notifications/contracts.ts `InboxChange`)
// `data` (event JSON) never contains a raw newline — JSON.stringify escapes them
// — so the client safely splits on the first three newlines.
/**
 * Translate an opaque client cursor into this process's numeric registry cursor.
 * A foreign or malformed cursor cannot be compared with this boot's counter, so
 * replay this boot's entire retained ring.
 */
export function decodeResumeCursor(raw: string | null, epoch: string): string | null {
  if (raw === null) return null
  const cursor = parseSessionCursor(raw)
  if (!cursor || cursor.epoch !== epoch) return '0'
  return cursor.sequence
}

/**
 * The explicit gap marker: frames after the client's cursor are gone — it came from another
 * boot, or the ring dropped them — so the replay that follows is not everything it missed. Its
 * cursor is the newest frame the server no longer holds; the replayed frames follow it.
 */
export function gapFrame(epoch: string, droppedThrough: string): string {
  return sessionFrame(epoch, droppedThrough, '', JSON.stringify({ type: 'transport.gap' }))
}

const WORKBENCH_UI_CAPABILITY = 'workbench-ui'

/**
 * Hard ceiling on the sessions ONE socket may watch. Real usage is the handful of mounted chat
 * surfaces; this only stops an unbounded set from growing on a buggy or hostile client, since the
 * set is read on every published frame.
 */
export const REALTIME_MAX_WATCHED_SESSIONS = 128

/**
 * The connect-time watched set, from `?watch=a,b,c`.
 *
 * It rides the URL rather than waiting for a `session.watch` command for a reason: between `onOpen`
 * and the first client command there is a window in which the socket is live and roster-only, and
 * every watched-class frame published in it — the deltas of the very session the user is looking at
 * — is dropped, unrecoverably (they are live-only). A reconnect mid-stream would visibly stall the
 * open transcript. The client already knows its set when it dials, so it declares it there.
 */
export function parseWatchQuery(raw: string | null): Set<string> {
  return admitWatchedSessions(new Set<string>(), raw ? raw.split(',') : [])
}

/**
 * Grow a watched set without letting it pass the ceiling.
 *
 * ONE rule for both entry points. Each used to carry its own copy — the connect-time query's was
 * tested, the live `session.watch` command's was not, and removing the command's ceiling was
 * caught by nothing while the same mutation in the query reddened immediately.
 *
 * Growth is REFUSED at the ceiling rather than making room: the ids already in the set belong to
 * surfaces that are still mounted, and evicting one would make it go silently blind.
 *
 * `!watching.has(id)` keeps a repeat from ending the batch early. It is deliberately NOT asserted
 * anywhere: a repeat adds nothing either way, so dropping the clause produces the same set and no
 * test could tell the two apart. The clause is intent, not a contract.
 */
export function admitWatchedSessions(watching: Set<string>, ids: Iterable<string>): Set<string> {
  for (const raw of ids) {
    const id = raw.trim()
    if (!id) continue
    if (watching.size >= REALTIME_MAX_WATCHED_SESSIONS && !watching.has(id)) break
    watching.add(id)
  }
  return watching
}

/** Baseline descriptor surface asserted by the realtime connection kind. */
export function realtimeConnectionToolSurface(
  surface: string | undefined,
): ToolSurface | undefined {
  // `/rpc/ws` historically belonged to the workbench and old/HMR-retained UI
  // sockets carry no marker. Preserve that protocol default: a non-workbench client
  // must identify itself explicitly with `surface=terminal` to get NO capabilities.
  // No first-party client sends that today, but the default stays opt-OUT rather than
  // opt-in so an unmarked HMR-retained socket never silently loses the workbench.
  return surface === 'terminal' ? undefined : { capabilities: [WORKBENCH_UI_CAPABILITY] }
}

/**
 * Merge connection-stable capabilities with the request's content-addressed
 * catalog binding. Descriptor availability is not execution authority; protected
 * authority remains derived exclusively by execution-context.ts.
 */
export function mergeRealtimeToolSurface(
  connection: ToolSurface | undefined,
  request: ToolSurface | undefined,
): ToolSurface | undefined {
  if (!connection) return request
  if (!request) return connection
  return {
    capabilities: [...new Set([...connection.capabilities, ...request.capabilities])],
    ...(request.catalogs ? { catalogs: request.catalogs } : {}),
  }
}

function sessionFrame(epoch: string, seq: string, sessionId: string, data: string): string {
  return `s\n${encodeSessionCursor(epoch, seq)}\n${sessionId}\n${data}`
}

const SESSION_COALESCE_MS = 8

type CoalescedSessionFrame = StreamEnvelope & { sourceFrames: number }

function appendOptional(previous?: string, next?: string): string | undefined {
  if (previous === undefined) return next
  if (next === undefined) return previous
  return previous + next
}

/** Collapse only adjacent deltas whose routing and append targets are identical. */
function coalesceSessionFrames(frames: readonly StreamEnvelope[]): CoalescedSessionFrame[] {
  const coalesced: CoalescedSessionFrame[] = []
  for (const frame of frames) {
    const previous = coalesced[coalesced.length - 1]
    if (
      !previous ||
      previous.sessionId !== frame.sessionId ||
      previous.event.type !== 'message.delta' ||
      frame.event.type !== 'message.delta' ||
      previous.event.messageId !== frame.event.messageId ||
      previous.event.textItemId !== frame.event.textItemId ||
      previous.event.reasoningItemId !== frame.event.reasoningItemId
    ) {
      coalesced.push({ ...frame, sourceFrames: 1 })
      continue
    }

    const event: AgentStreamEvent = {
      ...previous.event,
      textAppend: appendOptional(previous.event.textAppend, frame.event.textAppend),
      reasoningAppend: appendOptional(previous.event.reasoningAppend, frame.event.reasoningAppend),
      contentAppend: appendOptional(previous.event.contentAppend, frame.event.contentAppend),
      itemAppends:
        previous.event.itemAppends || frame.event.itemAppends
          ? [...(previous.event.itemAppends ?? []), ...(frame.event.itemAppends ?? [])]
          : undefined,
    }
    coalesced[coalesced.length - 1] = {
      ...frame,
      event,
      data: JSON.stringify(event),
      sourceFrames: previous.sourceFrames + 1,
    }
  }
  return coalesced
}

type PendingLagMarker = {
  cursor: string
  sessionId: string
  eventType: AgentStreamEvent['type']
  skipped: number
}

/**
 * Send one ordered server tick. Short-tick buffering folds adjacent output, but here only
 * adjacent COMPATIBLE deltas may fold, because this stream multiplexes sessions and event
 * types. A soft backpressure drop becomes an in-band lag marker carrying the skipped count,
 * so a consumer learns it lost frames instead of silently diverging.
 */
export function deliverSessionFrameBatch(
  frames: readonly StreamEnvelope[],
  options: {
    epoch: string
    bufferedBytes: () => number
    send: (frame: string) => void
    close: () => void
    onLagged?: (marker: Readonly<PendingLagMarker>) => void
    dropThreshold?: number
    hardCloseThreshold?: number
  },
): boolean {
  let pendingLag: PendingLagMarker | null = null
  const sendLag = () => {
    if (!pendingLag) return
    const marker = pendingLag
    pendingLag = null
    options.onLagged?.(marker)
    options.send(
      sessionFrame(
        options.epoch,
        marker.cursor,
        marker.sessionId,
        JSON.stringify({
          type: 'transport.lagged',
          skipped: marker.skipped,
          eventType: marker.eventType,
        }),
      ),
    )
  }

  for (const frame of coalesceSessionFrames(frames)) {
    const pressure = backpressureAction(
      isLiveOnlyEvent(frame.event.type),
      options.bufferedBytes(),
      options.dropThreshold,
      options.hardCloseThreshold,
    )
    if (pressure === 'close') {
      options.close()
      return true
    }
    if (pressure === 'drop') {
      if (
        pendingLag &&
        pendingLag.sessionId === frame.sessionId &&
        pendingLag.eventType === frame.event.type
      ) {
        pendingLag.cursor = frame.id
        pendingLag.skipped += frame.sourceFrames
      } else {
        sendLag()
        pendingLag = {
          cursor: frame.id,
          sessionId: frame.sessionId,
          eventType: frame.event.type,
          skipped: frame.sourceFrames,
        }
      }
      continue
    }
    sendLag()
    options.send(sessionFrame(options.epoch, frame.id, frame.sessionId, frame.data))
  }
  sendLag()
  return false
}

// Above the soft bound, drop LIVE-ONLY frames (deltas / latest-wins ticks) for a
// slow socket and emit a lag marker so the client reconciles from the DB instead
// of presenting a silent hole; the next full snapshot also resyncs it. Replayable
// frames must survive that valve, but they must not grow Bun's native send buffer
// without limit: once ANY stream tier crosses the hard bound, shed that client and
// let it reconnect + replay. Both bounds are deliberately high enough to trip only
// under genuine backpressure; the hard bound leaves headroom for a burst of
// replayable frames.
export const REALTIME_BACKPRESSURE_DROP_BYTES = 16 * 1024 * 1024
export const REALTIME_BACKPRESSURE_HARD_CLOSE_BYTES = 64 * 1024 * 1024
const BACKPRESSURE_CLOSE_CODE = 1013
const BACKPRESSURE_CLOSE_REASON = 'realtime backpressure'

export type BackpressureAction = 'send' | 'drop' | 'close'

/** Choose delivery for one session-stream frame without touching the socket. */
export function backpressureAction(
  liveOnly: boolean,
  bufferedBytes: number,
  dropThreshold: number = REALTIME_BACKPRESSURE_DROP_BYTES,
  hardCloseThreshold: number = REALTIME_BACKPRESSURE_HARD_CLOSE_BYTES,
): BackpressureAction {
  if (bufferedBytes > hardCloseThreshold) return 'close'
  if (liveOnly && bufferedBytes > dropThreshold) return 'drop'
  return 'send'
}

/** Current send-buffer depth, read defensively: 0 if the runtime doesn't expose it (→ never drops). */
function bufferedBytes(ws: unknown): number {
  const raw = (ws as { raw?: { getBufferedAmount?: () => number } }).raw
  return raw?.getBufferedAmount?.() ?? 0
}

export function createRealtimeRoute(deps: RealtimeDeps) {
  // Process-local registry ids restart at 1. Namespace them so a reconnecting
  // client never compares a previous API boot's high cursor with this boot's ids.
  const streamEpoch = randomUUID()
  return upgradeWebSocket((c: Context<AppContext>) => {
    const userId = c.get('userId')
    const connectionToolSurface = realtimeConnectionToolSurface(c.req.query('surface'))
    // Resume cursor: the client reconnects with ?since=<lastCursor> so it catches up
    // on events buffered while the socket was down (ids are monotonic within this boot).
    const resumeFrom = c.req.query('since') ?? null
    const since = decodeResumeCursor(resumeFrom, streamEpoch)
    // A cursor from another boot (or unreadable) names frames this process never held.
    const foreignResume = resumeFrom !== null && since === '0'
    // The sessions this connection renders. MUTATED IN PLACE for the socket's whole life — the
    // registry holds this exact reference and re-reads it per frame, so `session.watch` takes
    // effect on the next published event without touching the subscription or its cursor.
    const watching = parseWatchQuery(c.req.query('watch') ?? null)
    // The window, as the sessions it attaches to know it: one per socket.
    const clientId = `desktop:${randomUUID()}`

    let unsubChat: (() => void) | null = null
    let unsubNotifications: (() => void) | null = null
    // The socket's LSP channel: owns the docs this connection opened (so a drop
    // without a clean lsp.close still releases them) + the per-request neutral
    // fallbacks. See ws-lsp.ts.
    const lspChannel = createLspChannel({ lsp: deps.lsp, userId, logger: deps.logger })
    // Generic registry-driven live streams this connection opened (subsystem-
    // contributed subscribe/unsubscribe + tagged frames). Lazily bound in onOpen
    // (needs `ws`); `null` when no WS-frame registry is wired.
    let frameConn: WsFrameConnection | null = null
    // Latest-wins editor requests are cancellable by their client RPC id. Scoped
    // to this socket so one browser tab cannot cancel another tab's request.
    const controllers = new Map<string, AbortController>()
    let closedForBackpressure = false
    let pendingSessionFrames: StreamEnvelope[] = []
    let sessionFlushTimer: ReturnType<typeof setTimeout> | null = null
    let flushSessionFrames: (() => void) | null = null

    return {
      onOpen(_evt, ws) {
        flushSessionFrames = () => {
          if (sessionFlushTimer) clearTimeout(sessionFlushTimer)
          sessionFlushTimer = null
          if (closedForBackpressure || pendingSessionFrames.length === 0) return
          const frames = pendingSessionFrames
          pendingSessionFrames = []
          closedForBackpressure = deliverSessionFrameBatch(frames, {
            epoch: streamEpoch,
            bufferedBytes: () => bufferedBytes(ws),
            send: (frame) => {
              try {
                ws.send(frame)
              } catch {
                /* socket closing — onClose tears subscriptions down */
              }
            },
            close: () => {
              try {
                ws.close(BACKPRESSURE_CLOSE_CODE, BACKPRESSURE_CLOSE_REASON)
              } catch {
                /* socket already closing — onClose tears subscriptions down */
              }
            },
            onLagged: (marker) => {
              deps.logger.warn({
                event: 'ws.backpressure_drop',
                userId,
                sessionId: marker.sessionId,
                eventType: marker.eventType,
                skipped: marker.skipped,
              })
            },
          })
        }
        // Bind the generic WS-frame connection to this socket (registry-driven live
        // streams push `<frameTag>\n<json>` frames). The socket's user is bound HERE, from the
        // authenticated request, so a contribution never has to trust one named in params.
        if (deps.wsFrames) {
          frameConn = createWsFrameConnection(
            deps.wsFrames,
            (frame) => {
              flushSessionFrames?.()
              if (closedForBackpressure) return
              try {
                ws.send(frame)
              } catch {
                /* socket closing — onClose tears the streams down */
              }
            },
            { userId },
          )
        }
        // Chat firehose, SCOPED: every roster event for this user plus the full stream of the
        // sessions this connection declared it is rendering, each tagged with its routing key
        // (publish session id) so the client demuxes per session. Unscoped, one session's fan-out
        // of background sub-agents was enough to freeze the tab.
        deps.onWatch?.(clientId, [...watching], true)
        unsubChat = deps.subscribeScoped(
          userId,
          (envelope) => {
            if (closedForBackpressure) return
            pendingSessionFrames.push(envelope)
            sessionFlushTimer ??= setTimeout(flushSessionFrames!, SESSION_COALESCE_MS)
          },
          {
            since,
            watching,
            // Sent directly, ahead of the buffered replay it qualifies.
            onGap: (droppedThrough) => {
              if (!foreignResume) ws.send(gapFrame(streamEpoch, droppedThrough))
            },
          },
        )
        if (foreignResume) ws.send(gapFrame(streamEpoch, '0'))

        // Notification journal: every committed change to this user's inbox, as it commits.
        unsubNotifications =
          deps.notificationsSubscribe?.(userId, (change) => {
            flushSessionFrames?.()
            if (closedForBackpressure) return
            try {
              ws.send(`n\n${JSON.stringify(change)}`)
            } catch {
              /* socket closing */
            }
          }) ?? null
      },
      onMessage(evt, ws) {
        // Client→server RPC: `{id, t, ...}` → reply `r\n{id, ok, result|error}`.
        const raw = evt.data
        if (typeof raw !== 'string') return
        let msg: unknown
        try {
          msg = JSON.parse(raw)
        } catch {
          return
        }
        if (!msg || typeof msg !== 'object' || !('id' in msg) || typeof msg.id !== 'string') return
        const id = msg.id
        const requestControllers = controllers

        const reply = (body: Record<string, unknown>) => {
          flushSessionFrames?.()
          if (closedForBackpressure) return
          try {
            ws.send(`r\n${JSON.stringify({ id, ...body })}`)
          } catch {
            /* socket closing */
          }
        }
        const fail = (error: unknown) => {
          if (isApiError(error))
            reply({ ok: false, error: error.message, code: error.code, status: error.status })
          else
            reply({
              ok: false,
              error: error instanceof Error ? error.message : 'Request failed',
              status: 500,
            })
        }

        const command = parseRealtimeCommand(msg)
        if (command.kind === 'invalid') {
          reply({ ok: false, error: 'Invalid request', code: 'invalid_request', status: 400 })
          return
        }
        if (command.kind === 'cancel') {
          requestControllers.get(command.requestId)?.abort()
          reply({ ok: true, result: { cancelled: true } })
          return
        }

        if (command.kind === 'send') {
          const toolSurface = mergeRealtimeToolSurface(
            connectionToolSurface,
            command.body.toolSurface,
          )
          deps
            .sendMessage(
              userId,
              command.sessionId,
              command.body.prompt,
              command.body.bindings,
              undefined,
              command.body.isInternal,
              toolSurface,
              command.body.clientMessageId,
            )
            .then((result) => reply({ ok: true, result }))
            .catch(fail)
          return
        }
        if (command.kind === 'interact') {
          try {
            const result = deps.interact(
              command.body.toolCallId,
              command.body.action,
              command.body.payload,
              userId,
            )
            if (result.ok) reply({ ok: true, result: { ok: true } })
            else
              reply({
                ok: false,
                error: result.error ?? 'Interaction failed',
                code: 'interaction_failed',
                status: 404,
              })
          } catch (error) {
            fail(error)
          }
          return
        }
        if (command.kind === 'submit-secret') {
          // The masked-input value. Every reply on this branch is a FIXED string —
          // no `fail(error)` (an error message could quote its input) and never the
          // value or any part of the command body.
          const submitSecret = deps.submitSecret
          if (!submitSecret) {
            reply({
              ok: false,
              error: 'Secret submission unavailable',
              code: 'secret_request_not_active',
              status: 404,
            })
            return
          }
          Promise.resolve(submitSecret(command.body.requestId, command.body.value, userId))
            .then((result) => {
              if (result.ok) {
                reply({ ok: true, result: { ok: true } })
                return
              }
              // Pass the service's own code through: 'secret_storage_unavailable' must NOT be
              // conflated with 'not active' — the UI clears the overlay on not-active and would
              // resync the still-pending prompt straight back, looping the user. The code is one
              // of the service's fixed identifiers, never derived from the submitted value.
              const code = result.error ?? 'secret_request_not_active'
              reply({
                ok: false,
                error:
                  code === 'secret_storage_unavailable'
                    ? 'Secret storage unavailable'
                    : 'Secret request is not active',
                code,
                status: code === 'secret_storage_unavailable' ? 503 : 404,
              })
            })
            .catch(() => {
              reply({
                ok: false,
                error: 'Secret submission failed',
                code: 'secret_submit_failed',
                status: 500,
              })
            })
          return
        }
        if (command.kind === 'session.watch' || command.kind === 'session.unwatch') {
          // Mutate the set the registry already holds — no re-subscribe, so the resume cursor is
          // untouched (a re-subscribe would replay the ring and double-deliver every roster frame
          // in it; see the exactly-once contract on the registry).
          const before = new Set(watching)
          if (command.kind === 'session.watch') {
            admitWatchedSessions(watching, command.sessionIds)
          } else {
            for (const sessionId of command.sessionIds) watching.delete(sessionId)
          }
          deps.onWatch?.(
            clientId,
            [...watching].filter((id) => !before.has(id)),
            true,
          )
          deps.onWatch?.(
            clientId,
            [...before].filter((id) => !watching.has(id)),
            false,
          )
          reply({ ok: true, result: { watching: watching.size } })
          return
        }
        if (command.kind === 'stop') {
          deps
            .stop(command.sessionId, userId)
            .then((stopped) => reply({ ok: true, result: { stopped } }))
            .catch(fail)
          return
        }
        if (command.kind === 'preview-result') {
          // The host probe finished a `Browser` tool command — settle its promise.
          const { commandId, ok, result, error, errorCode, notEngaged, claim, release, hostId } =
            command.body
          const settled = deps.previewResult?.(
            commandId,
            {
              ok,
              result: result as PreviewResultPayload['result'],
              error,
              errorCode,
              notEngaged,
              claim,
              release,
              hostId,
            },
            userId,
          )
          reply({ ok: true, result: { resolved: settled?.ok ?? false } })
          return
        }
        if (command.kind === 'mini-app-command-result') {
          // A mini app's client sink answered an awaited command — settle its promise.
          const { commandId, ok, result, error } = command.body
          const settled = deps.miniAppCommandResult?.(commandId, { ok, result, error }, userId)
          reply({ ok: true, result: { resolved: settled?.ok ?? false } })
          return
        }
        if (lspChannel.handle(command, reply, fail)) return
        if (command.kind === 'inline.complete') {
          const completeInputs = deps.completeInputs
          if (!completeInputs) {
            reply({ ok: true, result: { completions: {} } })
            return
          }
          const controller = new AbortController()
          requestControllers.set(id, controller)
          completeInputs(userId, command.payload, controller.signal)
            .then((result) => reply({ ok: true, result }))
            .catch(fail)
            .finally(() => requestControllers.delete(id))
          return
        }
        if (command.kind === 'predictNextEdit') {
          const predictNextEdit = deps.predictNextEdit
          if (!predictNextEdit) {
            reply({ ok: true, result: { outcome: 'no_model', edits: null } })
            return
          }
          const controller = new AbortController()
          requestControllers.set(id, controller)
          predictNextEdit(userId, command.payload, controller.signal)
            .then((result) => reply({ ok: true, result }))
            .catch(fail)
            .finally(() => requestControllers.delete(id))
          return
        }
        if (command.kind === 'session.revoke-permission') {
          const revoke = deps.revokeSessionPermission
          if (!revoke) {
            reply({ ok: true, result: { autoApprovedTools: [] } })
            return
          }
          revoke(userId, command.sessionId, command.toolName)
            .then((autoApprovedTools) =>
              reply({ ok: true, result: { autoApprovedTools: autoApprovedTools ?? [] } }),
            )
            .catch(fail)
          return
        }
        // Generic WS-frame registry: a command ws.ts doesn't recognize may be a
        // subsystem/mini-app-contributed live stream (subscribe/unsubscribe). Consult
        // the registry before treating it as truly unknown. This is the sole home of
        // subsystem live streams — a bundled subsystem mini app registers its
        // subscribe/unsubscribe command pair + frame tag into the registry here.
        if (command.kind === 'unknown' && command.t && frameConn) {
          if (frameConn.subscribe(command.t, command.data)) {
            reply({ ok: true, result: { subscribed: true } })
            return
          }
          if (frameConn.unsubscribe(command.t, command.data)) {
            reply({ ok: true, result: { unsubscribed: true } })
            return
          }
        }
        deps.logger.warn({
          event: 'ws.unknown_command',
          userId,
          t: String((command as { kind?: string }).kind ?? 'unknown'),
        })
        // Every envelope carrying a request id must receive exactly one reply.
        // Silently logging an unknown command leaves the client's RPC promise alive
        // until its timeout and makes protocol/version skew look like a dead socket.
        reply({ ok: false, error: 'Unknown command', code: 'unknown_command', status: 404 })
      },
      onClose() {
        deps.onWatch?.(clientId, [...watching], false)
        if (sessionFlushTimer) clearTimeout(sessionFlushTimer)
        sessionFlushTimer = null
        pendingSessionFrames = []
        flushSessionFrames = null
        for (const controller of controllers.values()) controller.abort()
        controllers.clear()
        unsubChat?.()
        unsubNotifications?.()
        unsubChat = null
        unsubNotifications = null
        // Release every registry-driven live stream this connection started
        // (subsystem-contributed live streams, e.g. a bundled workbench's watch).
        frameConn?.teardown()
        frameConn = null
        // Release any LSP docs this connection left open (clean close never arrived).
        lspChannel.teardown()
      },
      onError(evt) {
        const cause = (evt as { error?: unknown }).error
        deps.logger.warn({
          event: 'ws.error',
          userId,
          detail: cause instanceof Error ? cause.message : evt.type,
        })
      },
    }
  })
}
