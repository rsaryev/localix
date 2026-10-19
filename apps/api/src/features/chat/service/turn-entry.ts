/**
 * Interactive and engine-dispatched turn entry for an existing session.
 * Both paths own their session mutation lock before validating and starting work.
 * Wake delivery is re-exported from turn-entry-wake.ts.
 */
import { ApiError } from '../../../lib/errors'
import { resolveMessageBindings } from './message-bindings'
import { assertUserWritableSession } from './session-access'
import {
  handleControlCommand,
  handlePluginCommand,
  handleSkillCommand,
  handleUnresolvedSlashCommand,
  type CommandHandlerContext,
} from './command-handlers'
import type { ToolSurface } from '@localixai/agent/agents'
import type { MessageBinding, MessageMutationResponse, WakeSource } from '../contracts'
import {
  childExecutionContext,
  rootExecutionContext,
  sessionExecutionContext,
} from '../runtime/execution-context'

import type { TurnEntryContext, RunJobTaskOptions } from './turn-entry-contracts'

export type { TurnEntryContext, RunJobTaskOptions } from './turn-entry-contracts'
export { wakeSession, wakeSessionAndWait, type WakeDelivery } from './turn-entry-wake'

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

    // ---- An open `ask` card takes the person's plain line as its answer -------
    // Instead of queuing behind the question it answers. Attachments and machine prompts are
    // not an answer; they keep the ordinary path.
    if (
      !origin &&
      !isInternal &&
      !bindings?.length &&
      ctx.answerPendingAsk?.(userId, sessionId, prompt)
    )
      return { sessionId, messageId: '', answeredInteraction: true }

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
        // Hidden or not, these are the words the person (or their channel) sent: the queue
        // routes them by their text, exactly as `runAgent` does when the session is idle.
        person: true,
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
