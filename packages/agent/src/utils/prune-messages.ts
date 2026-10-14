/**
 * General, composable message-pruning pipeline for the @localixai/agent SDK.
 *
 * `pruneMessages` walks a conversation and applies an ordered list of pure
 * `PruneRule`s to each message inside a protected window (the first message and a
 * recent tail are never touched). Rules return a partial patch (or `undefined` for
 * "no change"), the framework merges it immutably and counts what changed. This
 * mirrors the AI-SDK's composable-transform philosophy: small, single-purpose
 * rules you can compose, reorder, and extend without rewriting a monolithic
 * compactor.
 *
 * It is model-agnostic and operates on the persisted `ChatMessage` shape (where
 * tool results live on `toolParts`), so it is reusable across browser/server and
 * independent of any provider wire format. The policy (when to prune, and what a
 * pruned message still has to say) stays in the host; this is the reusable mechanism.
 */
import type { ChatMessage, MessageAttachment, MessageBinding } from '../chat'
import type { ToolBackedItem } from '../agents/items'

// ---- Core pipeline ------------------------------------------------------------

export interface PruneRuleContext {
  /** Position of this message in the full list. */
  index: number
  /** Total number of messages. */
  total: number
}

/**
 * A single pruning rule. Given a prunable message, return a partial patch to
 * merge into it, or `undefined` when nothing changes. Rules must be pure and
 * should return `undefined` (not an equal object) when they make no change, so
 * the framework can preserve references and report accurate counts.
 */
export interface PruneRule {
  /** Stable identifier, surfaced in `PruneResult.byRule`. */
  name: string
  apply(message: ChatMessage, ctx: PruneRuleContext): Partial<ChatMessage> | undefined
}

export interface PruneOptions {
  /** Ordered rules to apply to each prunable message. */
  rules: PruneRule[]
  /**
   * Protect the first message (it usually carries the original task/intent).
   * Default: `true`.
   */
  protectFirst?: boolean
  /**
   * Explicit index of the recent tail: messages at or after this index are never
   * pruned. Takes precedence over `keepRecentCount`. Default: none (only the tail
   * implied by `keepRecentCount`, or nothing).
   */
  keepRecentFromIndex?: number
  /** Protect the last N messages. Ignored when `keepRecentFromIndex` is set. */
  keepRecentCount?: number
}

export interface PruneResult<T extends ChatMessage = ChatMessage> {
  /** New array; unchanged messages keep their original reference. */
  messages: T[]
  /** Number of messages modified by at least one rule. */
  prunedCount: number
  /** Per-rule count of how many messages each rule modified. */
  byRule: Record<string, number>
}

/**
 * Apply the rule pipeline across `messages`, honoring the protected window.
 * Generic over the concrete message type so host wrappers (e.g. a persisted
 * payload that extends `ChatMessage`) keep their extra fields.
 */
export function pruneMessages<T extends ChatMessage>(
  messages: T[],
  options: PruneOptions,
): PruneResult<T> {
  const protectFirst = options.protectFirst ?? true
  const tailFrom =
    options.keepRecentFromIndex ??
    (options.keepRecentCount != null ? messages.length - options.keepRecentCount : messages.length)

  const byRule: Record<string, number> = {}
  let prunedCount = 0

  const out = messages.map((message, index) => {
    const isProtected = (protectFirst && index === 0) || index >= tailFrom
    if (isProtected) return message

    let next = message
    let changed = false
    for (const rule of options.rules) {
      const patch = rule.apply(next, { index, total: messages.length })
      if (!patch) continue
      next = { ...next, ...patch } as T
      changed = true
      byRule[rule.name] = (byRule[rule.name] ?? 0) + 1
    }
    if (changed) prunedCount++
    return next
  })

  return { messages: prunedCount > 0 ? out : messages, prunedCount, byRule }
}

// ---- Shared helpers -----------------------------------------------------------

/**
 * Model-facing result text of a tool-backed item, mirroring `itemsToWireMessages`'
 * `resultContent` preference order (error.userMessage → resultText → errorText),
 * so size thresholds reflect what actually re-enters the prompt. Rich display-only
 * fields (command `output`, file_change `diff`) are deliberately NOT model text.
 */
export function itemResultModelText(item: ToolBackedItem): string {
  return item.error?.userMessage ?? item.resultText ?? item.errorText ?? ''
}

// ---- Built-in rules -----------------------------------------------------------

export interface StripAssetBindingsOptions {
  /** Which attachment kinds to strip. Default: `['image', 'file', 'audio']` (keeps inlined text). */
  kinds?: Array<MessageAttachment['kind']>
  /** Builds the replacement text-attachment body. */
  placeholder?: (attachment: MessageAttachment) => string
}

/**
 * Replace heavy binary attachments (images, files) on old messages with a small
 * text placeholder, so prior-turn media stops re-entering the prompt. Demonstrates
 * pruning beyond tool results. `text` attachments are kept verbatim by default —
 * which is already cheap for a SPILLED attachment (its `text` is only a manifest +
 * head preview; the full bytes live on disk and are re-read lazily by file tools).
 */
export function stripAssetBindings(options: StripAssetBindingsOptions = {}): PruneRule {
  const kinds = new Set<MessageAttachment['kind']>(options.kinds ?? ['image', 'file', 'audio'])
  const placeholder =
    options.placeholder ??
    ((a: MessageAttachment) => `[${a.kind} "${a.name}" omitted from history]`)
  return {
    name: 'stripAssetBindings',
    apply(message) {
      const bindings = message.bindings
      if (!bindings || bindings.length === 0) return undefined
      let changed = false
      const next = bindings.map((a): MessageBinding => {
        if (a.kind === 'context' || a.kind === 'invocation') return a
        if (!kinds.has(a.kind)) return a
        if (a.kind === 'text') return a
        changed = true
        return { kind: 'text', name: a.name, text: placeholder(a), size: 0 }
      })
      return changed ? { bindings: next } : undefined
    },
  }
}
