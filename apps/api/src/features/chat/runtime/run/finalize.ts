/**
 * Successful run finalization: final persists, plugin assistant-message hooks,
 * run.completed and continuation triggers. Failure publication lives in
 * finalize-failure.ts and stays re-exported here. Continuations re-enter the runner via
 * env.run after clearing this run's activeRuns entry — the new run registers
 * the same session id synchronously, which the caller's finally block guards
 * against (see execute-run.ts).
 */
import { stopNotice } from './stop-notice'
import { announceRunStopped } from './finalize-notices'
import { settleConversationRow } from './finalize-conversation-turn'
import { isSilentConversationTurn } from './conversation-silence'
import { GENERAL_PURPOSE_AGENT } from '../../../ext/cc-agent-selection'

import type { SessionRecord } from '../../repository'
import type { PersistedMessage, MessageTiming } from '../../contracts'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { CcHooksRuntime } from '../../../cc-hooks'
import { runAssistantMessageHooks, runMemoryProviderRunEnd } from '../../../plugins/hooks'
import { finalizeTiming } from './turn-state'
import { publishSessionTiming, type TurnEventContext } from './event-handlers'
import type { ResolvedRunModel } from './model-selection'
import { findUsedKey, maskKey } from './key-meta'
import { consoleWarnLogger } from '../plugin-hook-logger'
import { maybeStartContinuation } from './run-continuations'
import type { RunParams } from './types'
import { settleConversationControlRepair } from './conversation-control-repair'
export { finalizeFailedRun, rateLimitBackoffMs } from './finalize-failure'

export async function finalizeSuccessfulRun(args: {
  ctx: TurnEventContext
  params: RunParams
  abort: AbortController
  providerEntry: ResolvedRunModel['providerEntry']
  rawModelId: string
  loadedPlugins: LoadedPlugins
  ccHooks: CcHooksRuntime
  promptMessage: PersistedMessage | undefined
  publishRuntimeSession: (status: SessionRecord['runtimeStatus']) => Promise<void>
}): Promise<boolean> {
  const { ctx, params, abort } = args
  const { env, userId, session, assistantMessageId, state, acc } = ctx
  const { stoppedRuntimeSessionIds } = env.state
  const { connection, providerId } = ctx

  state.currentPayload = settleConversationControlRepair(
    state.currentPayload,
    state.conversationControlRepairTurn,
  )
  state.payload = state.currentPayload

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

  const silentInConversation = isSilentConversationTurn(session, state.currentPayload)

  // If the run produced no visible content at all (model looped without text
  // or usable tool calls), add a fallback (in-memory; final persist below).
  if (!silentInConversation && !state.currentPayload.content && acc.isEmpty) {
    state.currentPayload = {
      ...state.currentPayload,
      content:
        'Something went wrong — I was unable to complete the task. Please try again or rephrase your request.',
    }
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

  // Fill the assistant row — or hide it, when this participant stayed out of the conversation —
  // and, if it handed the turn back to the person, mark it and say so
  // (`finalize-conversation-turn.ts` owns the order).
  await settleConversationRow(
    {
      streamRegistry: env.deps.streamRegistry,
      notifications: env.deps.notifications,
      persist: (payload) =>
        env.persistAndPublish(
          userId,
          session.id,
          assistantMessageId,
          payload,
          state.assistantCreatedAt,
        ),
    },
    { silent: silentInConversation, userId, session, payload: state.currentPayload },
  )
  const speakerAgentId = params.scope.speakerAgentId
  if (state.currentPayload.content?.trim()) {
    await env.boostReferencedAgentTurns(
      userId,
      session,
      speakerAgentId,
      state.currentPayload.content,
    )
  }
  publishSessionTiming(ctx)

  // Claude Code Stop hooks — fire when the turn's response is complete. Primary
  // use is side effects (desktop notifications, logging). A `decision:"block"` asks
  // the agent to KEEP WORKING with the reason fed back to it (CC: "prevents Claude
  // from stopping, continues the conversation"); we honor it via the continuation
  // seam below (maybeStartContinuation, gated + hard-capped). Best-effort; a
  // per-hook timeout bounds it, and it never throws (executor isolates failures).
  // `stop_hook_active` tells a well-behaved hook it is already inside a hook-forced
  // continuation so it can decline to block again (CC's own loop protection).
  let hookStopReason: string | undefined
  if (args.ccHooks.active) {
    const stopHookActive = params.chain.hookStopContinuationCount > 0
    const stop = await args.ccHooks.runStop({ stopHookActive })
    if (stop.blocked) {
      hookStopReason = stop.reason || 'A Stop hook asked you to keep working. Continue the task.'
    }
    // A delegated sub-agent (or a `context: fork` skill) whose frontmatter `Stop`
    // hooks were converted to `SubagentStop` fires them on its OWN completion —
    // scoped to skill/agent sources so the generic SubagentStop hooks the PARENT
    // already fired (via the delegate seam) are not double-fired. A block here rides
    // the SAME session continuation seam as Stop.
    const subScoped = (params.scope.ccScopedHooks ?? []).find((s) => s.asSubagent)
    if (subScoped) {
      const selfStop = await args.ccHooks.runSubagentStop(
        subScoped.agentType ?? GENERAL_PURPOSE_AGENT,
        session.id,
        state.currentPayload.content ?? null,
        { sourcesOnly: ['skill', 'agent'], stopHookActive },
      )
      if (selfStop.blocked && !hookStopReason) {
        hookStopReason =
          selfStop.reason || 'A SubagentStop hook asked you to keep working. Continue the task.'
      }
    }
  }

  env.deps.streamRegistry.publish(userId, session.id, {
    type: 'run.completed',
    sessionId: session.id,
    messageId: assistantMessageId,
    finishedAt: Date.now(),
  })

  // Auto-continuation chain (configuration reload / Stop-hook block):
  // when one fires it re-enters the runner and owns the next run's terminal
  // status — so we must NOT publish one here.
  const continued = await maybeStartContinuation({
    env,
    userId,
    session,
    state,
    params,
    abort,
    hookStopReason,
  })
  if (continued) return true

  await args.publishRuntimeSession(
    stoppedRuntimeSessionIds.has(session.id) ? 'stopped' : 'completed',
  )
  return false
}
