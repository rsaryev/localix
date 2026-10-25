/**
 * Agent-level chat utilities for @localixai/agent.
 *
 * Types (ChatMessage, etc.) live in @localixai/agent — the single source of truth.
 * This module adds utilities that require agent-level dependencies:
 * message-to-wire-format conversion, snapshot application, and cache snapshots.
 */

import type { ChatMessage } from '..'
import type { Message as WireMessage } from '..'
import { createChatCacheSnapshot } from '..'
import { isToolBackedItem, type AgentItem, type ToolBackedItem } from './items'
import { userMessageContent, withToolImages } from './model-attachments'
import { projectContinuationItems } from './continuation-items'
import type {
  ChatCacheDiagnosticsPayload,
  ChatCacheSnapshotPayload,
  ChatDataPart,
  ChatStatusPayload,
  ChatUsagePayload,
} from '..'

// Re-export all chat types from @localixai/agent so consumers only need one import.
export type { ChatMessage, DataPart } from '..'
export { safeJson, isLastAssistantMessage, stableStringify } from '..'

// ---- Agent chat message --------------------------------------------------------

/**
 * Agent-aware chat message — extends the base ChatMessage with typed data parts
 * for usage stats, cache diagnostics, and status updates.
 * Use this type in agent consumers; use base ChatMessage in UI-only consumers.
 */
export interface AgentChatMessage extends ChatMessage {
  dataParts?: ChatDataPart[]
  usage?: ChatUsagePayload
  cacheDiagnostics?: ChatCacheDiagnosticsPayload
  status?: ChatStatusPayload
}

/** Presentation snapshot consumed by chat UIs; unrelated to engine execution. */
export interface TurnSnapshot {
  text: string
  reasoning: string
  tools: unknown[]
  dataParts: ChatDataPart[]
  usage?: ChatUsagePayload
  status?: ChatStatusPayload
}

// ---- Message → wire format conversion ------------------------------------------

export { isWireCarriableImage } from './model-attachments'

/**
 * Rebuild the LLM wire from a normalized item list (the canonical successor to
 * contentBlocks+toolParts). Items are grouped by `turnIndex` and emitted as one
 * assistant + tool message pair per turn — preserving the real think→call→result
 * causal order. Unsigned narrative `reasoning` items are NOT re-sent (prior-turn CoT
 * is omitted to avoid re-billing it every turn); signed reasoning is provider protocol state
 * and is retained for same-origin replay.
 * Items with no `turnIndex` form a single trailing group (typical for CLI adapters).
 */
function itemsToWireMessages(items: AgentItem[]): WireMessage[] {
  const out: WireMessage[] = []
  const resultContent = (item: ToolBackedItem) =>
    item.error?.userMessage ?? item.resultText ?? item.errorText ?? ''
  const hasResult = (item: ToolBackedItem) =>
    item.status === 'completed' || item.status === 'failed' || item.status === 'aborted'
  /**
   * A tool whose item is still `running` HAS something to report — it just has no outcome yet.
   *
   * Async delegates and background jobs are deliberately left `running` (their real result lands
   * later, via the child/job resolution). Emitting no result for them left the assistant's tool call
   * unpaired, and `normalizeToolCallHistory` then has to repair the pair the only way it can from
   * inside a DB-less package: `{content: 'aborted', isError: true}`. Measured — that is exactly what
   * the model was shown for a sub-agent that was alive and working.
   *
   * The damage is not cosmetic. The delegate tool's own live result says "do NOT poll, sleep-wait, or
   * re-delegate this task"; the next history rebuild replaced that with an ERROR, which invites the
   * re-delegation the tool spent a sentence forbidding — two agents on one prompt in one worktree.
   * A prompt-level rule cannot survive a wire-level lie.
   */
  const RUNNING_NOTE =
    '[still running — the result arrives when it finishes; do not re-issue this call]'

  // Stable group key: turnIndex when set, else a single bucket for the tail.
  const flush = (group: AgentItem[]) => {
    const content: Array<
      | { type: 'text'; text: string; textSignature?: string }
      | { type: 'thinking'; thinking: string; thinkingSignature?: string; redacted?: boolean }
      | {
          type: 'tool_call'
          id: string
          name: string
          arguments: unknown
          thoughtSignature?: string
        }
    > = []
    const toolBacked: ToolBackedItem[] = []
    for (const item of group) {
      if (item.type === 'text' && (item.text || item.textSignature))
        content.push({ type: 'text', text: item.text, textSignature: item.textSignature })
      else if (item.type === 'reasoning' && item.thinkingSignature) {
        // Unsigned prior CoT remains omitted. Signature-bearing provider parts are
        // protocol state and must be replayed unchanged to their originating model.
        content.push({
          type: 'thinking',
          thinking: item.text,
          thinkingSignature: item.thinkingSignature,
          redacted: item.redacted,
        })
      } else if (isToolBackedItem(item)) {
        content.push({
          type: 'tool_call',
          id: item.toolCallId,
          name: item.name,
          arguments: item.input,
          thoughtSignature: item.thoughtSignature,
        })
        toolBacked.push(item)
      }
      // reasoning: intentionally not re-sent.
    }
    const origin = group.find((item) => item.model)
    // Protocol state like a signature: a provider that bound this turn's signed reasoning to a
    // level needs that level back, or it rejects or drops the reasoning on replay.
    const level = group.find((item) => item.providerThinkingLevel)?.providerThinkingLevel
    if (content.length > 0)
      out.push({
        role: 'assistant',
        api: origin?.api,
        provider: origin?.provider,
        model: origin?.model ?? 'unknown',
        ...(level ? { providerThinkingLevel: level } : {}),
        timestamp: Date.now(),
        content,
      })
    const results = toolBacked.flatMap((item) => {
      const running = item.status === 'running'
      // `pending` stays out: it never executed, so "aborted" is a fair description of it.
      if (!hasResult(item) && !running) return []
      const text = running
        ? [resultContent(item), RUNNING_NOTE].filter(Boolean).join('\n')
        : resultContent(item)
      return [
        {
          type: 'tool_result' as const,
          toolCallId: item.toolCallId,
          toolName: item.name,
          content: withToolImages(text, item.attachments),
          // Still running is not a failure. Only a terminal `failed` is.
          isError: item.status === 'failed',
          // Carry the live-state supersede key across the DB rehydrate so
          // `collapseSupersededSnapshots` (below) can pointer the stale same-key results
          // — e.g. every preview snapshot but the newest — cross-turn.
          ...(item.supersedeKey ? { supersedeKey: item.supersedeKey } : {}),
        },
      ]
    })
    if (results.length > 0) out.push({ role: 'tool', results, timestamp: Date.now() })
  }

  let group: AgentItem[] = []
  let currentTurn: number | undefined
  for (const item of items) {
    if (group.length > 0 && item.turnIndex !== currentTurn) {
      flush(group)
      group = []
    }
    currentTurn = item.turnIndex
    group.push(item)
  }
  if (group.length > 0) flush(group)
  return out
}

/**
 * Convert stored history to provider messages, retaining tool-call/result pairing.
 * Unsigned historical reasoning is omitted; signed provider protocol parts remain intact.
 * Repair repeated item ids in explicitly linked
 * continuations first. Independent live-state snapshots (`supersedeKey`) are collapsed
 * at a context checkpoint (`context/checkpoint/transforms.ts`), because collapsing one on the
 * turn a newer snapshot arrives rewrites a message the model has already read.
 */
export function toModelMessages(messages: ChatMessage[]): WireMessage[] {
  const result: WireMessage[] = []

  for (const message of projectContinuationItems(messages)) {
    if (!message.content && !message.items?.length && !message.bindings?.length) continue

    if (message.role === 'user') {
      result.push({ role: 'user', content: userMessageContent(message), timestamp: Date.now() })
      continue
    }

    // Item model (canonical): rebuild the wire from the normalized item list.
    if (message.items && message.items.length > 0) {
      result.push(...itemsToWireMessages(message.items))
    }
  }

  return result
}

export { markHistoryCacheAnchor, markForkCacheAnchor } from './cache-anchor'

// ---- Snapshot application ------------------------------------------------------

/**
 * Merge a TurnSnapshot into a partial AgentChatMessage update.
 * Suitable for applying incremental streaming progress or final turn results.
 */
export function applyTurnSnapshot(
  message: AgentChatMessage | undefined,
  snapshot: TurnSnapshot,
  cacheDiagnostics?: ChatCacheDiagnosticsPayload,
): Partial<AgentChatMessage> {
  return {
    content: snapshot.text || message?.content || '',
    reasoning: snapshot.reasoning || undefined,
    dataParts: cacheDiagnostics
      ? [
          { type: 'data-cache-diagnostics', data: cacheDiagnostics } as ChatDataPart,
          ...snapshot.dataParts,
        ]
      : snapshot.dataParts,
    usage: snapshot.usage,
    cacheDiagnostics,
    status: snapshot.status,
  }
}

// ---- Cache snapshot -------------------------------------------------------------

/**
 * Create a ChatCacheSnapshotPayload using deterministic runtime-agnostic hashing.
 *
 * Delegates to chat-cache's `createChatCacheSnapshot` so the system-prompt hash
 * goes through its memo (the prompt is constant per session — no point re-hashing
 * it every turn). Export shape is unchanged.
 */
export function createBrowserCacheSnapshot(params: {
  providerId?: string
  modelId: string
  systemPrompt: string
  /**
   * The half the provider actually caches, when the caller knows where the boundary is.
   * Omitted, it defaults to the whole system prompt — which made `stablePrefixHash` and
   * `systemPromptHash` identical for every caller, so the wire reported two fields carrying
   * one fact and "the cached half changed" could not be told apart from "the prompt changed".
   */
  stablePrefix?: string
  dynamicSuffix: string
  providerOptions: unknown
  toolNames: string[]
  messageCount: number
}): ChatCacheSnapshotPayload {
  return createChatCacheSnapshot({
    providerId: params.providerId,
    modelId: params.modelId,
    systemPrompt: params.systemPrompt,
    ...(params.stablePrefix !== undefined ? { stablePrefix: params.stablePrefix } : {}),
    dynamicSuffix: params.dynamicSuffix,
    providerOptions: params.providerOptions,
    toolNames: params.toolNames,
    messageCount: params.messageCount,
    hasSystemCacheBoundary: true,
  })
}
