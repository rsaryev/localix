/**
 * Successful run finalization: final persists, plugin assistant-message hooks,
 * run.completed and continuation triggers. Failure publication lives in
 * finalize-failure.ts and stays re-exported here. Continuations re-enter the runner via
 * env.run after clearing this run's activeRuns entry — the new run registers
 * the same session id synchronously, which the caller's finally block guards
 * against (see execute-run.ts).
 */
import { stopNotice } from './stop-notice'
import { announceEmptyReply, announceRunStopped } from './finalize-notices'
import { isPass, isSilentConversationTurn, settleConversationTurn } from './conversation-silence'
import { runStopHooks } from './finalize-stop-hooks'

import type { SessionRecord } from '../../repository'
import type { PersistedMessage, MessageTiming } from '../../contracts'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { ModRunScope } from '../../../mods/run-scope'
import { runAssistantMessageHooks, runMemoryProviderRunEnd } from '../../../plugins/hooks'
import { finalizeTiming } from './turn-state'
import { publishSessionTiming, type TurnEventContext } from './event-handlers'
import type { ResolvedRunModel } from './model-selection'
import { findUsedKey, maskKey } from './key-meta'
import { consoleWarnLogger } from '../plugin-hook-logger'
import { maybeStartContinuation } from './run-continuations'
import type { RunParams } from './types'
import type { RunPolicy } from '../../policy/run-policy'
import { routeConversationReply } from './conversation-routing'
import { runTeammateIdle, type TeammateIdleOutcome } from './teammate-idle'
import { publishedText } from '../spoken-text'
import { applyDisplayTexts } from './message-display'
export { finalizeFailedRun, rateLimitBackoffMs } from './finalize-failure'

export async function finalizeSuccessfulRun(args: {
  ctx: TurnEventContext
  params: RunParams
  abort: AbortController
  providerEntry: ResolvedRunModel['providerEntry']
  rawModelId: string
  loadedPlugins: LoadedPlugins
  ccHooks: CcHooksRuntime
  /** Claude Code mods: `turn.complete`, whose `{ text }` is a line under the answer. */
  mods?: ModRunScope
  promptMessage: PersistedMessage | undefined
  policy: RunPolicy
  publishRuntimeSession: (status: SessionRecord['runtimeStatus']) => Promise<void>
}): Promise<boolean> {
  const { ctx, params, abort } = args
  const { env, userId, session, assistantMessageId, state, acc } = ctx
  const { stoppedRuntimeSessionIds } = env.state
  const { connection, providerId } = ctx

  // Finalize timing now that all events are processed, and ensure the
  // persisted payload carries the latest aggregate.
  finalizeTiming(state)
  const finalTiming: MessageTiming = {
    ...state.timing,
    tools: [...state.timing.tools],
  }
  const usedKey = findUsedKey(connection, state.usedKeyId)
  const providerMeta = {
    providerId,
    providerName: args.providerEntry.name,
    modelId: args.rawModelId,
    keyLabel: usedKey?.label || undefined,
    keyMasked: maskKey(usedKey),
  }
  if (state.currentPayload.timing !== finalTiming) {
    state.currentPayload = {
      ...state.currentPayload,
      timing: finalTiming,
      providerMeta,
    }
    state.payload = state.currentPayload
  } else if (state.currentPayload.providerMeta === undefined) {
    state.currentPayload = { ...state.currentPayload, providerMeta }
    state.payload = state.currentPayload
  }

  // A turn that ends with only tool items keeps EMPTY assistant text — we never
  // fabricate model-voiced filler ("Completed N tool calls." / "Updated N files.").
  // The tool cards already show exactly what happened; an invented sentence in the
  // model's voice is misleading. The genuine-empty guard below still covers a run
  // that produced no text AND no tool items.

  // A mark asks for a turn the agent may decline: an empty answer to it is silence, not failure.
  const silentInConversation = isSilentConversationTurn(
    args.policy.conversation,
    state.currentPayload,
    args.policy.trigger.answersReaction,
  )

  // A run that produced nothing at all — no text, no tool call — is said as the system, like
  // every other ending below: a sentence under the agent's name would be one it never wrote.
  if (!silentInConversation && !state.currentPayload.content && acc.isEmpty) {
    await announceEmptyReply({ env, userId, sessionId: session.id, assistantMessageId })
  }

  // THE TURN LIMIT CUT THIS RUN SHORT, said as a SYSTEM LINE rather than as text in the
  // assistant row: the finalizer fabricates nothing in the model's voice, and a paragraph under
  // a model's name IS its voice. It fires whether or not the model got some text out — the old
  // guard existed only because the notice was written INTO the row, where it would have
  // overwritten a real answer, and the case it excluded is the common one.
  const notice = stopNotice(state.stopReason)
  if (notice && !silentInConversation) {
    await announceRunStopped({ env, userId, sessionId: session.id, assistantMessageId }, notice)
  }

  // Plugin onAssistantMessage hooks: the final reply is complete — plugins
  // may replace the persisted text and/or add message bindings.
  // Runs before the final persist so the result lands in ONE write.
  if (args.loadedPlugins.hooks.length > 0 && state.currentPayload.content) {
    const hookResult = await runAssistantMessageHooks(
      args.loadedPlugins.hooks,
      { messageId: assistantMessageId, content: state.currentPayload.content },
      {
        sessionId: session.id,
        logger: consoleWarnLogger,
      },
    )
    if (hookResult.content !== undefined || hookResult.bindings !== undefined) {
      // `items` is the UI's source of truth — mirror a content rewrite into
      // the text items. Only safe when the turn produced exactly ONE text
      // item (the common case): with several, `content` is their flat
      // concatenation and can't be re-split, so the rewrite then applies
      // only to `content` (channel/API replies + LLM history), not the UI.
      let items = state.currentPayload.items
      if (hookResult.content !== undefined && items?.length) {
        const textIndexes = items.flatMap((it, i) => (it.type === 'text' ? [i] : []))
        if (textIndexes.length === 1) {
          const idx = textIndexes[0]!
          items = items.map((it, i) => (i === idx ? { ...it, text: hookResult.content! } : it))
        }
      }
      state.currentPayload = {
        ...state.currentPayload,
        ...(hookResult.content !== undefined ? { content: hookResult.content } : {}),
        ...(items !== state.currentPayload.items ? { items } : {}),
        ...(hookResult.bindings !== undefined
          ? {
              bindings: [...(state.currentPayload.bindings ?? []), ...hookResult.bindings],
            }
          : {}),
      }
    }
  }

  // Claude Code mods' `session.append`: the answer as stored, rewritten before the final write.
  if (args.mods) state.currentPayload = await args.mods.storeResponse(state.currentPayload)

  // External memory provider: fire-and-forget extraction pass with the
  // completed turn (user prompt + final assistant text, post-hook).
  if (args.loadedPlugins.memory) {
    runMemoryProviderRunEnd(
      args.loadedPlugins.memory,
      {
        sessionId: session.id,
        projectId: session.projectId,
        userText:
          args.promptMessage?.payload.role === 'user' &&
          typeof args.promptMessage.payload.content === 'string'
            ? args.promptMessage.payload.content
            : '',
        assistantText: state.currentPayload.content ?? '',
      },
      { logger: consoleWarnLogger },
    )
  }

  // CC MessageDisplay: what the person is shown in place of each text block, in the same write.
  if (!silentInConversation) await applyDisplayTexts(args.ccHooks, ctx, args.promptMessage?.id)
  // Fill the assistant row — or hide it, when this participant stayed out of the conversation.
  await settleConversationTurn(
    {
      streamRegistry: env.deps.streamRegistry,
      persist: (payload) =>
        env.persistAndPublish(
          userId,
          session.id,
          assistantMessageId,
          payload,
          state.assistantCreatedAt,
        ),
    },
    {
      silent: silentInConversation,
      userId,
      sessionId: session.id,
      payload: state.currentPayload,
    },
  )
  // The reply itself hands the floor on: whoever it addresses answers next, or the colleague who
  // asked for this turn hears back. Queued turns of colleagues it merely names move up. Everything
  // the turn said counts, not only its last model call: an address written before a tool call is
  // still an address (`spoken-text.ts`).
  const reply = silentInConversation ? '' : publishedText(state.currentPayload)
  // A PreToolUse `continue:false` or a PostToolBatch block ended the run: Claude Code "stops
  // processing entirely", so no TeammateIdle, Stop or SubagentStop hook and no continuation may
  // send the agent back to work.
  const hookStopped = args.ccHooks.stoppedBy() !== undefined
  // CC TeammateIdle, before the floor moves on: a member sent back to work keeps it.
  const idle: TeammateIdleOutcome = hookStopped
    ? {}
    : await runTeammateIdle(
        args.ccHooks,
        args.policy,
        session,
        params.scope.speakerAgentId,
        (message) =>
          env.deps.streamRegistry.publish(userId, session.id, {
            type: 'hook.notice',
            sessionId: session.id,
            message,
            hookEvent: 'TeammateIdle',
          }),
      )
  if (!idle.keepWorking) {
    await routeConversationReply(env, params, {
      content: reply,
      passed: silentInConversation && isPass(state.currentPayload),
    })
    if (reply.trim())
      await env.boostReferencedAgentTurns(userId, session, params.scope.speakerAgentId, reply)
  }
  publishSessionTiming(ctx)

  // Claude Code Stop hooks — SubagentStop for a delegated child (`finalize-stop-hooks.ts`). A
  // block keeps the agent working through the continuation seam below (gated + hard-capped).
  let hookStopReason = idle.keepWorking
  if (args.ccHooks.active && !idle.stopped && !idle.keepWorking) {
    hookStopReason = await runStopHooks({
      ccHooks: args.ccHooks,
      session,
      scope: params.scope,
      stopHookActive: params.chain.hookStopContinuationCount > 0,
      content: state.currentPayload.content ?? null,
    })
  }

  const modLine = await args.mods?.turnComplete({
    answer: state.currentPayload.content ?? '',
    turnId: args.promptMessage?.id ?? assistantMessageId,
    durationMs: Math.max(0, Date.now() - Date.parse(state.assistantCreatedAt)),
    reason: 'answer',
  })
  if (modLine)
    env.deps.streamRegistry.publish(userId, session.id, {
      type: 'hook.notice',
      sessionId: session.id,
      message: modLine,
      hookEvent: 'turn.complete',
    })

  env.deps.streamRegistry.publish(userId, session.id, {
    type: 'run.completed',
    sessionId: session.id,
    messageId: assistantMessageId,
    finishedAt: Date.now(),
  })

  // Auto-continuation chain (configuration reload / Stop-hook block):
  // when one fires it re-enters the runner and owns the next run's terminal
  // status — so we must NOT publish one here.
  const continued =
    !hookStopped &&
    (await maybeStartContinuation({
      env,
      userId,
      session,
      state,
      params,
      abort,
      hookStopReason,
    }))
  if (continued) return true

  await args.publishRuntimeSession(
    stoppedRuntimeSessionIds.has(session.id) ? 'stopped' : 'completed',
  )
  return false
}
