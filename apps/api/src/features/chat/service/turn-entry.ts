/**
 * TURN ENTRY — every way an agent turn gets STARTED (or queued) on a session
 * that already exists.
 *
 * There are five origins, and they differ only in where the prompt comes from and
 * what pre-flight applies before it reaches `runAgent`:
 *
 *  - `sendMessage`        — the user typed it. Slash-command chain first, then
 *                           @-ref expansion, then run-or-queue.
 *  - `runJobTask`         — an engine dispatched it (delegated task run, delegate sub-agent).
 *  - `wakeSession`        — an internal system push into a live chat session.
 *  - `applyModeTransition`— a mode switch that MAY carry a continuation turn.
 *
 * They all share the same skeleton (mutation lock → load + validate the session →
 * either enqueue a wake or call `runAgent`), which is why they live together: a
 * change to the run-or-queue policy has exactly one home. Gathering them here also
 * keeps service.ts a wiring root + a public API surface rather than an
 * implementation file.
 */
import { agentParticipant } from '../../../db/participant'
import { ApiError, errorMessage } from '../../../lib/errors'
import { resolveMessageBindings } from './message-bindings'
import { assertUserWritableSession, type SessionMutationLock } from './session-access'
import {
  handleControlCommand,
  handlePluginCommand,
  handleSkillCommand,
  handleUnresolvedSlashCommand,
  type CommandHandlerContext,
} from './command-handlers'
import type { ChatServiceDeps } from './context'
import type { createRunAgent } from './run-agent'
import type { ChatRepository, SessionRecord } from '../repository'
import type { createAgentRunner } from '../runtime/agent-runner'
import type { ToolSurface } from '@localixai/agent/agents'
import type { RunProfile } from '../../agent-core/run-shape'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { MessageBinding, MessageMutationResponse, WakeRequest, WakeSource } from '../contracts'
import {
  childExecutionContext,
  rootExecutionContext,
  sessionExecutionContext,
  type RunInvocation,
} from '../runtime/execution-context'
import type { RunExecutionOutcome } from '../runtime/run-outcome'

export interface TurnEntryContext {
  deps: ChatServiceDeps
  repo: ChatRepository
  runner: ReturnType<typeof createAgentRunner>
  streamRegistry: SessionStreamRegistry
  now: () => string
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  publishSession: (session: SessionRecord) => void
  runAgent: ReturnType<typeof createRunAgent>
  /** The slash-command chain's context (control / plugin / skill handlers). */
  commandCtx: CommandHandlerContext
  withSessionMutationLock: SessionMutationLock
}

/** Options of an engine-dispatched job/subagent turn. */
export interface RunJobTaskOptions {
  invocation: Exclude<RunInvocation, { kind: 'root' }>
  extraDisabledTools?: string[]
  profileOverride?: RunProfile
  wait?: boolean
  bindings?: MessageBinding[]
  maxTurns?: number
  ccScopedHooks?: {
    raw: unknown
    source: 'skill' | 'agent'
    asSubagent?: boolean
    agentType?: string
  }[]
}

/**
 * The user typed something. Four gates run before a turn ever starts, in order:
 * control slash commands (/model, /clear, …), plugin commands, skill commands —
 * each of which may fully answer the message — then quiet @-ref expansion. Only
 * then is the turn run, or QUEUED if the session is busy.
 */
export async function sendMessage(
  ctx: TurnEntryContext,
  userId: string,
  sessionId: string,
  prompt: string,
  bindings?: MessageBinding[],
  /** Provenance of a non-frontend send (e.g. `'external'` for an inbound webhook).
   *  Stamped on the persisted user row so the source is distinguishable
   *  downstream; the frontend omits it (→ a plain user turn). */
  origin?: WakeSource,
  /** Client-requested transcript hiding — a machine-composed prompt the user triggered but did
   *  not type (e.g. a contributed analysis action). The model sees it; the UI does not. */
  isInternal?: boolean,
  /** Capabilities of the client/runtime surface initiating this turn. */
  toolSurface?: ToolSurface,
  /** Originating optimistic UI row for exact busy-queue reconciliation. */
  clientMessageId?: string,
): Promise<MessageMutationResponse> {
  const { deps, repo, runner, now, requireSession, runAgent, commandCtx } = ctx
  return ctx.withSessionMutationLock(sessionId, async () => {
    const session = await requireSession(userId, sessionId)
    assertUserWritableSession(session)
    // The person wrote here themselves (no `origin`, not a hidden machine prompt): anything this
    // conversation asked of them is answered (`attention/sources.ts` `mentionAttention`).
    if (!origin && !isInternal) deps.notifications?.mentions.answered(userId, sessionId)
    // Commands share a service-lifetime context, while the client surface is
    // turn-scoped. Wrap both ways a command can start work for this request:
    // ordinary control commands call runAgent directly, while plugin/skill
    // commands use runMacroCommand. Keeping the adaptation here makes every
    // current and future command inherit the initiating workbench catalog
    // without mutable shared state or handler-by-handler plumbing.
    const turnCommandCtx: CommandHandlerContext = toolSurface
      ? {
          ...commandCtx,
          runAgent: (
            commandUserId,
            commandSessionId,
            commandSession,
            existingMessages,
            commandPrompt,
            timestamp,
            commandBindings,
            opts,
          ) =>
            commandCtx.runAgent(
              commandUserId,
              commandSessionId,
              commandSession,
              existingMessages,
              commandPrompt,
              timestamp,
              commandBindings,
              { ...opts, toolSurface },
            ),
          runMacroCommand: (
            macroUserId,
            macroSessionId,
            macroSession,
            existingMessages,
            visiblePrompt,
            instruction,
            timestamp,
            opts,
          ) =>
            commandCtx.runMacroCommand(
              macroUserId,
              macroSessionId,
              macroSession,
              existingMessages,
              visiblePrompt,
              instruction,
              timestamp,
              { ...opts, toolSurface },
            ),
        }
      : commandCtx

    // ---- Control slash commands (/usage, /model, /clear, …) -------------------
    const controlResult = await handleControlCommand(
      turnCommandCtx,
      userId,
      sessionId,
      session,
      prompt,
    )
    if (controlResult) return controlResult

    // ---- Plugin slash commands (/<plugin>:<command>) --------------------------
    const pluginResult = await handlePluginCommand(
      turnCommandCtx,
      userId,
      sessionId,
      session,
      prompt,
      bindings,
    )
    if (pluginResult) return pluginResult

    // ---- User skill commands (/<skill-name>) ----------------------------------
    const skillResult = await handleSkillCommand(turnCommandCtx, userId, sessionId, session, prompt)
    if (skillResult) return skillResult

    // Anything still shaped like a slash command is unresolved. Fail closed
    // with a catalog-derived hint instead of silently asking the model to
    // interpret a typo or a client-only command this surface did not handle.
    const unresolvedSlash = await handleUnresolvedSlashCommand(
      turnCommandCtx,
      userId,
      sessionId,
      session,
      prompt,
    )
    if (unresolvedSlash) return unresolvedSlash

    // ---- Quiet @-link expansion --------------------------------------------
    // Resolve the composer's @-links into what this turn carries (a durable
    // context capture and/or model-only `contextRef` attachments). Before the
    // busy check, so a queued (wake) turn carries its expansions too.
    bindings = await resolveMessageBindings(deps, userId, session, bindings)

    if (runner.isBusy(sessionId)) {
      // A run is active OR a wake is mid-drain — the user's own stream, or a
      // loop tick. (isBusy, not isRunning: the drain sets its draining flag
      // before activeRuns, so isRunning alone would let this user message run
      // straight into an "already running" rejection and be silently dropped.)
      // Don't drop the message with a 409 (which silently loses it on any
      // client/server isGenerating de-sync). Queue it in the person's band
      // (`queue-policy.ts`): after the answers still owed to their earlier
      // message, ahead of any colleague chain and any machine wake. The turn
      // is created when the active run finishes and the wake drains; the UI
      // renders it from the streamed message.created event.
      await runner.wake({
        userId,
        session,
        content: prompt,
        // A non-frontend origin (e.g. an inbound webhook) is a SYSTEM turn:
        // hide it from the transcript like a loop wake — the UI lifts
        // its `source` onto the assistant reply as a "via external" line. A
        // plain busy user send stays visible (internal: false) unless the
        // client asked for hiding (a machine-composed prompt).
        internal: Boolean(origin) || isInternal === true,
        source: origin ?? 'user-busy',
        toolSurface,
        ...(clientMessageId ? { clientMessageId } : {}),
        ...(bindings && bindings.length > 0 ? { bindings } : {}),
      })
      return { sessionId, messageId: '', queued: true }
    }

    const timestamp = now()

    return runAgent(
      userId,
      sessionId,
      session,
      // Deferred on purpose: this is the interactive path, and the whole transcript
      // load used to sit between the user pressing send and their own message echoing
      // back. Handing `runAgent` the loader lets it publish the echo first and read
      // the history behind it — see `ExistingMessages`. The other callers here are
      // engine-dispatched (no one is watching a composer), so they keep passing arrays.
      () => repo.listMessages(userId, sessionId),
      prompt,
      timestamp,
      bindings,
      session.sessionKind === 'subagent' || origin || isInternal || toolSurface || clientMessageId
        ? {
            // A non-frontend origin (inbound webhook) is a hidden SYSTEM turn:
            // isInternal keeps it out of the transcript (the UI shows a "via
            // external" line on the assistant reply instead), matching a loop wake.
            ...(origin ? { isInternal: true } : {}),
            // Client-requested hiding: a machine-composed prompt (analysis wizard).
            ...(isInternal ? { isInternal: true } : {}),
            ...(clientMessageId ? { clientMessageId } : {}),
            executionContext:
              session.sessionKind === 'subagent'
                ? sessionExecutionContext(session, toolSurface, origin)
                : rootExecutionContext(toolSurface, origin),
          }
        : undefined,
    )
  })
}

/**
 * Internal entry point for engine-dispatched job sessions (delegated task runs,
 * delegate sub-agents, recurring tasks). `sendMessage` rejects non-chat sessions
 * (runtime sessions are read-only to the user), so the engine starts agent runs
 * through this path instead.
 */
export async function runJobTask(
  ctx: TurnEntryContext,
  userId: string,
  sessionId: string,
  task: string,
  opts: RunJobTaskOptions,
): Promise<MessageMutationResponse> {
  const { repo, now, requireSession, runAgent } = ctx
  return ctx.withSessionMutationLock(sessionId, async () => {
    const session = await requireSession(userId, sessionId)
    if (session.sessionKind !== 'job' && session.sessionKind !== 'subagent') {
      throw new ApiError(
        409,
        'not_a_job_session',
        'runJobTask only accepts job or subagent sessions',
      )
    }
    // A child closed while it waited for its lane never starts (`subagent-close.ts`).
    if (session.closedAt) throw new ApiError(409, 'session_closed', 'This sub-agent was closed')
    const allMessages = await repo.listMessages(userId, sessionId)
    return runAgent(userId, sessionId, session, allMessages, task, now(), opts?.bindings, {
      extraDisabledTools: opts?.extraDisabledTools,
      profileOverride: opts?.profileOverride,
      // CC `maxTurns` — per-run cap on the sub-agent's turn count.
      maxTurns: opts?.maxTurns,
      // CC skill/agent frontmatter `hooks` — active for this child run only.
      ccScopedHooks: opts?.ccScopedHooks,
      // Synchronous delegation: block until the sub-agent's run fully
      // completes so the caller can read its final result.
      wait: opts?.wait,
      // A job/subagent prompt is ALWAYS engine/orchestrator-injected (a delegation
      // brief, a reviewer prompt, a loop's task), never user-typed.
      // Hide it from the sub-session transcript (UI filters isInternal) — the
      // model still receives it (only uiOnly is dropped from model history) —
      // and tag its provenance so it isn't noise in the worker/sub-agent view.
      isInternal: true,
      executionContext: childExecutionContext(opts.invocation),
    })
  })
}

/**
 * Why a wake did not land. `gone` and `not-chat` are ordinary outcomes; `unreadable`
 * is a repository failure and the only one worth telling an operator about.
 */
export type WakeMiss = 'gone' | 'not-chat' | 'unreadable'

/** The answer {@link wakeSession} owes its caller. `detail` carries the store's raw text. */
export interface WakeDelivery {
  delivered: boolean
  missed?: WakeMiss
  detail?: string
}

const DELIVERED: WakeDelivery = { delivered: true }

/**
 * Load the target of a wake, distinguishing "no such session" from "the store failed".
 *
 * Both wake entry points below are fire-and-forget at every call site (a plugin, the
 * sleep timer, a finished child's report), so neither can propagate: an
 * unhandled rejection there would take out an unrelated turn. But `catch(() => null)`
 * made a transient repository error indistinguishable from a deleted session, and the
 * consequence is not symmetric — a dropped report wake leaves the parent waiting with
 * nothing anywhere saying why. A 404 is the ordinary case and stays quiet; anything else is
 * named, AND reported back so the producer can log it against its own subject.
 */
async function loadWakeTarget(
  ctx: TurnEntryContext,
  userId: string,
  sessionId: string,
): Promise<{ session: SessionRecord } | { session?: undefined; miss: WakeMiss; detail?: string }> {
  try {
    return { session: await ctx.requireSession(userId, sessionId) }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { miss: 'gone' }
    console.error(`[wake] could not load session ${sessionId}; the wake was dropped`, err)
    return { miss: 'unreadable', detail: errorMessage(err) }
  }
}

/**
 * Push an internal message into a CHAT session and run it — how a producer that is not the
 * person (a loop, a finished child, a plugin) starts a turn. No-op if the session is gone or
 * isn't a chat session.
 *
 * It ANSWERS whether the wake landed. Every producer is fire-and-forget by design (a
 * wake must never fail the turn that caused it), which used to mean a repository error
 * dropped a wake into silence with nothing anywhere saying why. The producer knows what the wake was FOR, so it is the only place that can say
 * what was lost — this hands it the fact, and each call site logs it against its own
 * subject. Retrying is deliberately NOT done here: see the call sites.
 */
export async function wakeSession(
  ctx: TurnEntryContext,
  request: WakeRequest,
): Promise<WakeDelivery> {
  const target = await loadWakeTarget(ctx, request.userId, request.sessionId)
  if (!target.session) return { delivered: false, missed: target.miss, detail: target.detail }
  if (!acceptsWake(target.session, request)) return { delivered: false, missed: 'not-chat' }
  await ctx.runner.wake(wakeParams(target.session, request))
  return DELIVERED
}

/**
 * A chat takes any wake. A delegated child takes exactly one kind: the report of a child it
 * delegated itself — once children delegate in turn, that report answers the child that asked,
 * which integrates it and reports upward (`delegation-report.ts`). Nothing else wakes a child
 * session through here, and a closed one takes nothing at all.
 */
function acceptsWake(session: SessionRecord, request: WakeRequest): boolean {
  if (session.sessionKind === 'chat') return true
  return (
    request.source === 'subagent' &&
    session.sessionKind === 'subagent' &&
    session.provenance.kind === 'task-delegation' &&
    !session.closedAt
  )
}

/**
 * The queue's view of a request, against the session as it is NOW.
 *
 * An addressee who has left the conversation is dropped rather than kept: the drain dismisses a
 * delivery no current participant answers, so a loop armed by @qa, or a report owed to the
 * participant who delegated, would otherwise vanish once they were removed. Without `to` the
 * conversation's own strategy chooses who answers — the wake still lands.
 */
function wakeParams(session: SessionRecord, request: WakeRequest) {
  const { userId, content, source, to, addressedAs, deliveryKey, receipt, extraDisabledTools } =
    request
  const present =
    to !== undefined &&
    session.agents.some((member) => agentParticipant(member.agentId) === to.participant)
  return {
    userId,
    session,
    content,
    source,
    ...(extraDisabledTools ? { extraDisabledTools } : {}),
    ...(request.plugin ? { plugins: [request.plugin] } : {}),
    ...(deliveryKey ? { deliveryKey, ...(receipt ? { receipt } : {}) } : {}),
    ...(present ? { to } : to === undefined && addressedAs !== undefined ? { addressedAs } : {}),
  }
}

/**
 * Scheduler-facing wake that observes the run outcome instead of only durable
 * queue admission. Kept separate from ordinary fire-and-forget wake producers
 * so background completions never inherit scheduler backpressure semantics.
 */
export async function wakeSessionAndWait(
  ctx: TurnEntryContext,
  request: WakeRequest,
): Promise<RunExecutionOutcome> {
  // Repository failures must stay distinguishable from an unsupported session
  // kind: collapsing both to "unavailable/non-retryable" made a transient DB
  // outage permanently count as a scheduler failure.
  const session = await ctx.requireSession(request.userId, request.sessionId)
  if (session.sessionKind !== 'chat') {
    return {
      status: 'failed',
      kind: 'fatal',
      message: `Session ${request.sessionId} is unavailable for a scheduled wake.`,
      retryable: false,
      rateLimited: false,
    }
  }
  return ctx.runner.wakeAndWait(wakeParams(session, request))
}
