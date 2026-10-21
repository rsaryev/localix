import { agentRoute } from '../../../../contracts/session-route'
/**
 * agentLoop event handling for one run: named handlers per event type,
 * operating on RunTurnState through an explicit TurnEventContext. Assistant-content,
 * flush, tool and HITL handlers live in their owning sibling modules.
 */
import type {
  AssistantMessage,
  ChatCacheDiagnosticsPayload,
  ChatContextAnchorIdentity,
} from '@localixai/agent'
import type { AgentEvent } from '@localixai/agent/agents'
import type { LiveItemResolver } from '../agent-runner-state'

import { calcUsageWithCost, classifyCostSource } from '../run-accounting'
import { normalizeUsage } from '../usage-normalize'
import { publishSessionUsageSnapshot } from '../session-usage'
import type { createItemAccumulator } from '../items'
import type { RunHookContext } from './run-hook-context'
import {
  finalizeTiming,
  foldTurnTiming,
  accumulateTurnUsage,
  type RunTurnState,
} from './turn-state'
import type { ResolvedRunModel } from './model-selection'
import { findUsedKey, maskKey } from './key-meta'
import { flushOrPublish } from './event-handlers-flush'
import {
  scanAssistantContent,
  syncAssistantParts,
  applyAssistantDelta,
} from './event-assistant-content'
export { scanAssistantContent, applyAssistantDelta } from './event-assistant-content'
import { handleHitlRequest, handleHitlResponse } from './event-handlers-hitl'
import {
  handleToolExecutionStart,
  handleToolExecutionUpdate,
  handleToolExecutionEnd,
} from './event-handlers-tools'

// Re-export so the historical './event-handlers' import surface (tests +
// sibling handlers) stays stable after the flush logic + hook context moved out.
export { flushOrPublish, persistNow, publishSessionTiming } from './event-handlers-flush'
export type { HookRunOptions } from './run-hook-context'

export type AgentLoopEvent = AgentEvent
export type EventOf<T extends AgentLoopEvent['type']> = Extract<AgentLoopEvent, { type: T }>

export interface TurnEventContext extends RunHookContext {
  state: RunTurnState
  acc: ReturnType<typeof createItemAccumulator>
  connection: ResolvedRunModel['connection']
  providerId: string
  modelCost: Parameters<typeof calcUsageWithCost>[1]
  cacheDiagnostics: ChatCacheDiagnosticsPayload | undefined
  /** Durable identity persisted beside the last request's context measurement. */
  contextAnchorIdentity: ChatContextAnchorIdentity
  /**
   * Generic live-item resolver registry (from RuntimeState.liveItemResolvers).
   * Tools that leave their item `running` pending an async child register here
   * so that child completion can patch the in-memory payload without racing the
   * parent run's own persistAndPublish calls. Deregistered in the run's finally.
   */
  liveItemResolvers: Map<string, LiveItemResolver>
  /**
   * Keys registered into liveItemResolvers by THIS run, so the finally block
   * can deregister any that never fired (child outlived the parent run).
   */
  runLiveResolverKeys: Set<string>
  /**
   * Tools that can change something outside this process, by their declared `mutates` flag.
   * Dispatching one is the single edge where a crash makes "send again" unsafe, so it is
   * forced to disk rather than left to the streaming flush cadence.
   */
  mutatingToolNames?: ReadonlySet<string>
  /**
   * The provider's input count for the request just answered, handed to the host so the
   * per-model token calibration learns from it. Absent for strategies that do not learn.
   */
  observeMeasuredContext?: (measuredInputTokens: number) => void
}

function handleTurnStart(ctx: TurnEventContext, event: EventOf<'turn_start'>) {
  const { state } = ctx
  state.currentTurnIndex = event.turnIndex
  state.currentTurnText = ''
  state.currentTurnTextIndex = undefined
  state.currentTurnReasoning = ''
  state.turnStartedAt = Date.now()
  state.turnFirstTokenAt = undefined
  state.turnToolGenAt = undefined
  state.timing.turns += 1
}

/**
 * PI emits `turn_end` only after the assistant message and every tool result for
 * that turn. This is the last safe replay boundary if the following provider
 * request overflows before producing a usable response.
 */
export function captureCompletedTurnCheckpoint(
  ctx: Pick<TurnEventContext, 'state'>,
  event: EventOf<'turn_end'>,
) {
  if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') return
  finalizeTiming(ctx.state)
  const payload: typeof ctx.state.currentPayload = {
    ...ctx.state.currentPayload,
    timing: { ...ctx.state.timing, tools: [...ctx.state.timing.tools] },
  }
  ctx.state.payload = payload
  ctx.state.currentPayload = payload
  ctx.state.completedTurnCheckpoint = {
    payload,
    createdAt: ctx.state.assistantCreatedAt,
  }
  ctx.state.completedToolTurnIndex = event.toolResults.length > 0 ? event.turnIndex : undefined
  ctx.state.completedTurnIndex = event.turnIndex
}

async function handleMessageUpdate(ctx: TurnEventContext, event: EventOf<'message_update'>) {
  const { state } = ctx
  const changed = applyAssistantDelta(ctx, event.delta)
  // Record per-turn wall markers (fallback when the provider stream does
  // not expose genTimings; accumulation happens at message_end).
  if (state.turnFirstTokenAt === undefined && changed.narrative) {
    state.turnFirstTokenAt = Date.now()
  }
  if (state.turnToolGenAt === undefined && changed.toolCall) {
    state.turnToolGenAt = Date.now()
  }
  await flushOrPublish(ctx, state.payload)
}

async function handleMessageEnd(ctx: TurnEventContext, event: EventOf<'message_end'>) {
  if (event.message.role !== 'assistant') return
  const { env, state, acc } = ctx
  const message = event.message as AssistantMessage
  const { text, reasoning, toolCalls, parts } = scanAssistantContent(message)
  state.currentTurnText = text
  state.currentTurnReasoning = reasoning
  syncAssistantParts(acc, state.currentTurnIndex, message, parts)
  foldTurnTiming(state, message.genTimings, Date.now())
  finalizeTiming(state)
  // Fold token buckets into run totals, but price this REQUEST before aggregation:
  // long-context tiers are request-scoped, not cumulative across a tool loop.
  if (message.usage) {
    // Force catalog pricing for the fallback ledger even when this ONE turn carries
    // provider-reported actual cost. A mixed run must not relabel actual charges as estimates.
    const estimate = calcUsageWithCost(
      { ...message.usage, costSource: undefined },
      ctx.modelCost,
    ).totalCost
    accumulateTurnUsage(state, message.usage, estimate)
    // inputTokens is the normalized whole-request context (see accumulateTurnUsage).
    // A response cut short carries estimated counts: priced, never taken as the context's size.
    const measuredInput = message.usage.estimated ? 0 : normalizeUsage(message.usage).inputTokens
    if (measuredInput > 0) ctx.observeMeasuredContext?.(measuredInput)
  }
  // Run cost is 'actual' only if every usage-bearing turn reported it;
  // otherwise use the sum of request-scoped catalog estimates.
  const runUsage = calcUsageWithCost(state.usageTotals)
  if (state.turnsWithUsage > 0 && state.turnsWithActualCost === state.turnsWithUsage) {
    runUsage.totalCost = state.actualCostSum
    runUsage.costSource = 'actual'
  } else if (ctx.modelCost && state.turnsWithUsage > 0) {
    // Tier thresholds are per request, so price each turn before accumulation.
    runUsage.totalCost = state.estimatedCostSum
    runUsage.costSource = 'estimated'
  }
  // Real per-REQUEST context size of the last turn — the totals above are sums
  // over every turn of the run and must never be read as a context estimate.
  if (state.lastTurnContextTokens) {
    runUsage.contextTokens = state.lastTurnContextTokens
    runUsage.contextIdentity = ctx.contextAnchorIdentity
  }
  // Reconcile progressively-streamed tool items: a retried turn re-issues
  // NEW tool call ids, so `pending` items whose id is absent from the
  // final message are stale leftovers of an aborted attempt — drop them.
  acc.reconcile(new Set(toolCalls.map((c) => c.id)))
  // Reclassify 'estimated' → 'subscription' when the run used an OAuth key
  // (e.g. Claude Pro/Max). The catalog figure is an API-equivalent value, not
  // real metered spend.  Must happen AFTER the actual-cost override above so
  // only non-actual turns are reclassified.
  const usedKey = findUsedKey(ctx.connection, state.usedKeyId)
  if (runUsage.costSource !== 'actual') {
    runUsage.costSource = classifyCostSource(usedKey?.authType, runUsage.costSource)
  }
  const route = message.usage ? agentRoute(ctx.session, ctx.agentId) : undefined
  state.payload = {
    ...state.payload,
    content: text.trim() ? text : state.payload.content,
    items: acc.list(),
    reasoning: reasoning || undefined,
    ...(message.usage ? { usage: runUsage } : {}),
    // What the usage ledger row is derived from: the turn's routing, on the message itself.
    ...(route
      ? {
          turnEnd: {
            finishReason: message.stopReason,
            keyId: state.usedKeyId ?? undefined,
            keyLabel: usedKey?.label || undefined,
            keyMasked: maskKey(usedKey) ?? undefined,
            providerId: ctx.providerId ?? undefined,
            modelId: route.modelId,
            providerConnectionId: route.providerConnectionId ?? undefined,
          },
        }
      : {}),
    ...(ctx.cacheDiagnostics ? { cacheDiagnostics: ctx.cacheDiagnostics } : {}),
    timing: { ...state.timing, tools: [...state.timing.tools] },
  }
  state.currentPayload = state.payload
  await env.persistAndPublish(
    ctx.userId,
    ctx.session.id,
    ctx.assistantMessageId,
    state.payload,
    state.assistantCreatedAt,
  )
  // The message's usage changed, which announces it: the usage-ledger projector writes its row
  // (`usage/ledger-projector.ts`). The session's total reads the messages, so it is told now.
  if (state.payload.usage)
    void publishSessionUsageSnapshot({
      repo: env.repo,
      usageRepo: env.usageRepo,
      streamRegistry: env.deps.streamRegistry,
      userId: ctx.userId,
      sessionId: ctx.session.id,
    })
}

/** Dispatch one agentLoop event to its handler. `error` events re-throw. */
export async function handleAgentEvent(
  ctx: TurnEventContext,
  event: AgentLoopEvent,
): Promise<void> {
  switch (event.type) {
    case 'turn_start':
      handleTurnStart(ctx, event)
      break
    case 'message_update':
      await handleMessageUpdate(ctx, event)
      break
    case 'message_end':
      await handleMessageEnd(ctx, event)
      break
    case 'tool_execution_start':
      await handleToolExecutionStart(ctx, event)
      break
    case 'tool_execution_update':
      await handleToolExecutionUpdate(ctx, event)
      break
    case 'human_in_loop_request':
      handleHitlRequest(ctx, event)
      break
    case 'human_in_loop_response':
      handleHitlResponse(ctx, event)
      break
    case 'tool_execution_end':
      await handleToolExecutionEnd(ctx, event)
      break
    case 'turn_end':
      captureCompletedTurnCheckpoint(ctx, event)
      break
    case 'agent_end':
      // The ONLY place the loop reports WHY it stopped. Dropped on the floor before
      // this, so a budget-braked run was indistinguishable from a finished one.
      ctx.state.stopReason = event.stopReason
      break
    case 'error':
      throw event.error
    // Nothing to persist: `agent_start`/`message_start` are covered by the
    // turn/message events above. (A failed tool is one `tool_execution_end` whose result
    // says `isError` — there is no separate error event to ignore any more.)
    case 'agent_start':
    case 'message_start':
      break
  }
}
