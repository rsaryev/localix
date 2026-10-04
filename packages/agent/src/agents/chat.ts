/**
 * Agent-level chat utilities for @localixai/agent.
 *
 * Types (ChatMessage, etc.) live in @localixai/agent — the single source of truth.
 * This module adds utilities that require agent-level dependencies:
 * message-to-wire-format conversion, snapshot application, and cache snapshots.
 */

import { assetBindings, type ChatMessage } from '..'
import type { Message as WireMessage, TextContent, ImageContent, FileContent } from '..'
import { createChatCacheSnapshot } from '..'
import { isToolBackedItem, type AgentItem, type ToolBackedItem } from './items'
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

/**
 * Convert a ChatMessage history to the wire-format messages expected by the provider.
 * Automatically injects tool_result messages after assistant messages with tool calls,
 * ensuring the conversation conforms to the multi-turn tool-use protocol.
 *
 * Reasoning / chain-of-thought is INTENTIONALLY excluded from the wire output.
 * Every message passed here is prior-turn HISTORY (the live, in-progress turn is
 * produced directly by the agent loop, not through this converter). Re-sending the
 * full thinking of every past turn re-bills it as input on every subsequent turn —
 * an unbounded token sink that grows with the conversation. The model only needs
 * the final answer text + tool calls + tool results to stay coherent on replay;
 * the verbatim CoT is for the human (rendered live in the UI), not for re-feeding.
 * The runtime follows the same principle of not re-feeding prior-turn CoT. (Within a single
 * run, our `transform-messages` keeps same-model thinking blocks for
 * reasoning/signature continuity; but THIS persisted-history converter never
 * reconstructs thinking from stored items at all, so cross-run history carries no
 * CoT regardless. The pi adapter performs the final wire conversion.)
 */
/** Allowed image media types for the wire `ImageContent` part. */
const IMAGE_MEDIA_TYPES = new Set<ImageContent['mediaType']>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/**
 * Whether the wire can carry these bytes as a real `ImageContent` part.
 *
 * THE boundary, in one place. It used to be re-listed in the pi codec and again in the
 * composer, and the copies were consistent — but the SPILL decision asked a different
 * question ("is it an image?") and so excluded every `image/*` from spilling on the
 * grounds that "pi carries ImageContent". That grounds only holds for these four: a
 * HEIC, SVG, BMP or TIFF was excluded from spilling AND unrepresentable on the wire, so
 * it reached the model as the bare text stub `[Attached file: x.heic]`. Anything this
 * returns false for must be given to the model as a FILE ON DISK, not as bytes.
 */
export function isWireCarriableImage(mediaType: string): boolean {
  return IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase() as ImageContent['mediaType'])
}

/**
 * What to send when an attachment reaches the wire with no bytes.
 *
 * Dropping the part is the one thing that must not happen. The user can see the file
 * attached in their message, so silence makes the model answer as if nothing were
 * attached — it cannot tell the user that the file never arrived, because it does not
 * know one was meant to. A visible failure the model can report beats an invisible one.
 * So an unsendable part is replaced with text that states the problem and says to tell
 * the user.
 */
function missingBytes(att: { name?: string; mediaType: string }): TextContent {
  const what = att.name ? `"${att.name}"` : att.mediaType
  return {
    type: 'text',
    text:
      `The attachment ${what} could not be loaded — its content was unavailable when this ` +
      `message was prepared, so you cannot see it. Tell the user it did not reach you.`,
  }
}

/**
 * Build the wire content for a user message. Context/invocation bindings are
 * materialized by the host before this SDK boundary; only asset bindings become
 * provider content parts here.
 */
function userMessageContent(
  message: ChatMessage,
): string | Array<TextContent | ImageContent | FileContent> {
  const attachments = assetBindings(message.bindings)
  if (attachments.length === 0) return message.content ?? ''

  const parts: Array<TextContent | ImageContent | FileContent> = []
  if (message.content) parts.push({ type: 'text', text: message.content })

  for (const att of attachments) {
    if (att.kind === 'image' && IMAGE_MEDIA_TYPES.has(att.mediaType as ImageContent['mediaType'])) {
      // A file-backed attachment whose bytes weren't rehydrated by the host has no
      // `data`. An empty wire part is not an option (the SDK never reads `mediaId`;
      // rehydration is the host's job) — but neither is dropping it, see `missingBytes`.
      if (att.data)
        parts.push({
          type: 'image',
          mediaType: att.mediaType as ImageContent['mediaType'],
          data: att.data,
        })
      else parts.push(missingBytes(att))
    } else if (
      att.kind === 'image' ||
      att.kind === 'file' ||
      att.kind === 'audio' ||
      att.kind === 'video'
    ) {
      // Non-standard image types, audio, and video fall through to a generic
      // file part (generated video on assistant replies is never re-sent, but a
      // user-attached clip should ride as a file rather than a text stub).
      if (att.data)
        parts.push({ type: 'file', mediaType: att.mediaType, data: att.data, filename: att.name })
      else parts.push(missingBytes(att))
    } else if (att.kind === 'text') {
      // A spilled attachment's `text` is already a self-contained manifest (path +
      // head preview + re-read instructions), and a context-ref expansion's `text`
      // is already a self-contained block (header + fenced content) — both are
      // produced host-side and emitted raw, not re-fenced as a code block. A
      // normal (inlined) text attachment is fenced.
      if (att.spilled || att.contextRef) parts.push({ type: 'text', text: att.text })
      else
        parts.push({
          type: 'text',
          text: `Attached file: ${att.name}\n\n\`\`\`\n${att.text}\n\`\`\``,
        })
    } else if (att.kind === 'path') {
      // Path attachments are host-owned resources, just like `mediaId`: the SDK never
      // reads them, and the host replaces the persisted path with a spilled-text manifest
      // on its model-wire copy. If one still arrives here that replacement did not run —
      // so name the path instead of emitting nothing. The model has file tools and the
      // path is all it needs, which turns a silent loss into a usable attachment.
      parts.push({
        type: 'text',
        text:
          `The user attached the file at ${att.path}, but its contents were not inlined. ` +
          `Read it from that path if you need it.`,
      })
    }
  }

  return parts.length > 0 ? parts : (message.content ?? '')
}

/**
 * A tool result's wire content: its text, then the images it returned.
 *
 * The bytes are the host's to supply — it rehydrates `data` from the media store onto the wire
 * copy, and only when this request's model accepts images. An image without `data` is therefore
 * one this request must not carry, and it is NAMED rather than dropped, for the same reason as
 * {@link missingBytes}: a model that reads "the screenshot is not shown" says so, while one that
 * reads nothing may describe a picture it never saw.
 */
function withToolImages(
  text: string,
  attachments: ToolBackedItem['attachments'],
): string | Array<TextContent | ImageContent> {
  if (!attachments?.length) return text
  const parts: Array<TextContent | ImageContent> = text ? [{ type: 'text', text }] : []
  for (const att of attachments) {
    if (att.data && IMAGE_MEDIA_TYPES.has(att.mediaType as ImageContent['mediaType']))
      parts.push({
        type: 'image',
        mediaType: att.mediaType as ImageContent['mediaType'],
        data: att.data,
      })
    else
      parts.push({
        type: 'text',
        text: '[The image this tool returned is not included in this request.]',
      })
  }
  return parts
}

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
    if (content.length > 0)
      out.push({
        role: 'assistant',
        api: origin?.api,
        provider: origin?.provider,
        model: origin?.model ?? 'unknown',
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
 * Convert stored messages to wire messages — a pure, per-message mapping. It never looks across
 * messages to change an earlier one: stale live-state snapshots (`supersedeKey`) are collapsed
 * at a context checkpoint (`context/checkpoint/transforms.ts`), because collapsing one on the
 * turn a newer snapshot arrives rewrites a message the model has already read.
 */
export function toModelMessages(messages: ChatMessage[]): WireMessage[] {
  const result: WireMessage[] = []

  for (const message of messages) {
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

/**
 * Mark the prompt-cache anchor on a freshly rebuilt run history: the SECOND-TO-LAST
 * message. The last message is this turn's own addition (its runtime context, or the trigger
 * itself), sent for the first time; everything before it is byte-stable across rebuilds —
 * this converter is deterministic and the host's history is append-only between context
 * checkpoints. The pi adapter forwards the flag and `anthropic-messages` turns it into
 * an explicit `cache_control` breakpoint on that message, so the rebuilt history is READ
 * from cache across runs instead of re-written every run. Idempotent; clears any stale
 * anchor first. Mutates in place and returns the same array.
 */
export function markHistoryCacheAnchor(messages: WireMessage[]): WireMessage[] {
  for (const m of messages) if (m.cacheAnchor) delete m.cacheAnchor
  // Walk back from the second-to-last message to the first one that will still be
  // on the wire after `transformMessages` — which DROPS an assistant turn whose
  // `stopReason` is 'error'/'aborted'. Anchoring a message that then gets dropped
  // means no breakpoint lands and the whole history re-writes to cache that run.
  // (Today `toModelMessages` emits no `stopReason`, so this never fires in the
  // rebuilt-history path — but a caller passing raw AssistantMessages, or a future
  // change that carries stopReason through, would silently lose the anchor.)
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && (m.stopReason === 'error' || m.stopReason === 'aborted')) continue
    m.cacheAnchor = true
    break
  }
  return messages
}

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
