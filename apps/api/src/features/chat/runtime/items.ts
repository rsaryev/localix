import type { ToolErrorPayload } from '@localixai/agent'
import { isToolBackedItem } from '@localixai/agent/agents'
import type {
  AgentItem,
  AgentItemStatus,
  AgentSource,
  AgentToolPresentation,
  ToolActionDescriptor,
  ToolGateProvenance,
  ToolImageAttachment,
} from '@localixai/agent/agents'

import { buildToolItem, reasoningItem, textItem, type ToolItemSpec } from './item-builders'
import { mergeToolItemSpec } from './item-tool-spec'

/** Where a streamed part came from, kept on its item so a later run replays it to its origin. */
type ItemOrigin = Pick<AgentItem, 'api' | 'provider' | 'model' | 'providerThinkingLevel'>

// Re-export the pure item builders so the historical `./items` import surface
// (callers + tests importing buildToolItem/classifyTool/textItem/reasoningItem/
// ToolItemSpec) stays stable after the builders moved to ./item-builders.
export {
  buildToolItem,
  classifyTool,
  reasoningItem,
  textItem,
  type ToolItemSpec,
} from './item-builders'

export interface ItemAccumulatorOptions {
  /**
   * Applied to every tool `input` and `details` this accumulator records, before the spec is stored.
   *
   * It belongs HERE and not only at the event handlers because the handlers are not the first writer.
   * pi emits `message_end` BEFORE any `tool_execution_start` (`agent-loop.ts`), and `message_end`
   * runs `syncAssistantParts` → `streamTool`, which takes `input` straight from
   * `toolCall.arguments`. So a `bash` command carrying an inline credential was already persisted to
   * `agent_messages` and streamed to every client by the time `handleToolExecutionStart` overwrote it
   * with a shielded copy — and if the run aborts or the process dies in between, the raw value is
   * what STAYS. Shielding the funnel (`setTool`) closes `streamTool`, `startTool` and
   * `updateToolDetails` together, so a fourth writer cannot reopen it.
   *
   * The handlers still shield their own copies: those feed sinks this accumulator does not own
   * (`pendingTools`, the child-session mirror). Redacting an already-redacted value is a no-op.
   */
  sanitize?: (value: unknown) => unknown
  /** Tool-owned presentation boundary; avoids any name-based plugin cases in core. */
  standaloneFor?: (name: string) => boolean
  /** Descriptor-owned transcript treatment for built-in, deferred, plugin and MCP tools. */
  presentationFor?: (name: string) => AgentToolPresentation | undefined
  /** Current live actions projected from the host registry at each item update. */
  actionsFor?: (toolCallId: string) => ToolActionDescriptor[] | undefined
}

/**
 * Stateful accumulator that folds an agent run's streaming events into an ordered
 * `AgentItem[]` — the item-native replacement for the old contentBlocks+toolParts
 * bookkeeping. Items are upserted by id, order preserved by first appearance:
 * narrative text/reasoning per turn, tool-backed items materialized from accumulated
 * specs via `buildToolItem`. Pure given its inputs; the runtime just feeds it events
 * and reads `list()`.
 */
export function createItemAccumulator(
  activeVerbFor: (name: string) => string,
  opts: ItemAccumulatorOptions = {},
) {
  const sanitize = opts.sanitize ?? ((value: unknown) => value)
  let items: AgentItem[] = []
  const specs = new Map<string, ToolItemSpec>()
  const firstTextIndex = new Map<number, number>()
  const firstReasoningIndex = new Map<number, number>()
  const textByPart = new Map<string, string>()
  const reasoningByPart = new Map<string, string>()
  // id → position in `items`, so upsert is O(1) instead of an O(n) findIndex on
  // every streamed token (text/reasoning re-upsert their item per delta, and a
  // long turn accumulates many tool items the scan would otherwise walk past).
  const indexById = new Map<string, number>()
  // Indices into `items` in persisted/streamed order. Existing ids keep their
  // sort key, so only structural changes can invalidate this cached order.
  let sortedOrder: number[] | undefined

  const upsert = (item: AgentItem) => {
    const idx = indexById.get(item.id)
    if (idx === undefined) {
      items.push(item)
      indexById.set(item.id, items.length - 1)
      sortedOrder = undefined
    } else {
      // `list()` is the ownership boundary: callers only ever receive a copy of
      // this array. Replacing an element in the private array therefore cannot
      // mutate an already-published snapshot, and avoids cloning the whole item
      // list for every cumulative provider delta. `message_update` re-upserts
      // every content part seen so far, so the old slice made one token O(parts ×
      // items) in allocations even though lookup itself is O(1).
      items[idx] = item
    }
  }

  const setTool = (toolCallId: string, patch: Partial<ToolItemSpec> & { name: string }) => {
    const prev = specs.get(toolCallId)
    const spec = mergeToolItemSpec({ toolCallId, patch, prev, activeVerbFor, opts, sanitize })
    specs.set(toolCallId, spec)
    upsert(buildToolItem(spec))
  }

  const partKey = (turnIndex: number, contentIndex: number) => `${turnIndex}:${contentIndex}`

  const setText = (
    turnIndex: number,
    text: string,
    contentIndex = 0,
    meta?: ItemOrigin & { textSignature?: string },
  ) => {
    textByPart.set(partKey(turnIndex, contentIndex), text)
    const first = firstTextIndex.get(turnIndex) ?? contentIndex
    firstTextIndex.set(turnIndex, first)
    upsert({
      ...textItem(
        contentIndex === first ? `text-${turnIndex}` : `text-${turnIndex}-${contentIndex}`,
        text,
        turnIndex,
        'completed',
      ),
      contentIndex,
      ...meta,
    })
  }

  const setReasoning = (
    turnIndex: number,
    text: string,
    contentIndex = 0,
    meta?: ItemOrigin & { thinkingSignature?: string; redacted?: boolean },
  ) => {
    reasoningByPart.set(partKey(turnIndex, contentIndex), text)
    const first = firstReasoningIndex.get(turnIndex) ?? contentIndex
    firstReasoningIndex.set(turnIndex, first)
    upsert({
      ...reasoningItem(
        contentIndex === first
          ? `reasoning-${turnIndex}`
          : `reasoning-${turnIndex}-${contentIndex}`,
        text,
        turnIndex,
        'completed',
      ),
      contentIndex,
      ...meta,
    })
  }

  return {
    /** Upsert this turn's narrative text. */
    text: setText,
    /** Append one provider text fragment without rescanning the cumulative message. */
    appendText(
      turnIndex: number,
      delta: string,
      contentIndex = 0,
      meta?: ItemOrigin & { textSignature?: string },
    ) {
      const key = partKey(turnIndex, contentIndex)
      setText(turnIndex, (textByPart.get(key) ?? '') + delta, contentIndex, meta)
    },
    /** Upsert this turn's reasoning. */
    reasoning: setReasoning,
    /** Append one provider reasoning fragment without rescanning cumulative parts. */
    appendReasoning(
      turnIndex: number,
      delta: string,
      contentIndex = 0,
      meta?: ItemOrigin & { thinkingSignature?: string; redacted?: boolean },
    ) {
      const key = partKey(turnIndex, contentIndex)
      setReasoning(turnIndex, (reasoningByPart.get(key) ?? '') + delta, contentIndex, meta)
    },
    /** Progressive tool-call streaming (args still being written): status `pending`. */
    streamTool(
      turnIndex: number,
      call: {
        id: string
        name: string
        arguments?: unknown
        contentIndex?: number
        thoughtSignature?: string
      } & ItemOrigin,
    ) {
      const { id: _id, arguments: input, ...metadata } = call
      setTool(call.id, { input, status: 'pending', turnIndex, ...metadata })
    },
    /** Tool execution began: status `running` with validated input. */
    startTool(turnIndex: number, toolCallId: string, name: string, input: unknown) {
      setTool(toolCallId, { name, input, status: 'running', turnIndex })
    },
    /** Live details during execution (e.g. streamed command output). */
    updateToolDetails(toolCallId: string, name: string, details: unknown) {
      setTool(toolCallId, { name, details, status: 'running' })
    },
    /**
     * A late outcome for an item this row still OWNS — one that lands after its call returned (an async
     * child's outcome while the run that started it is still going). False when the row no
     * longer holds the item (it was split off by `reset`), so the caller writes the stored row
     * instead: patching here would re-create the item inside the wrong row.
     */
    patchToolItem(
      toolCallId: string,
      patch: { status?: AgentItemStatus; details?: unknown; resultText?: string },
    ) {
      const prev = specs.get(toolCallId)
      if (!prev) return false
      setTool(toolCallId, { name: prev.name, ...patch })
      return true
    },
    /** Tool finished: terminal status + result. */
    endTool(
      toolCallId: string,
      name: string,
      patch: {
        status: AgentItemStatus
        details?: unknown
        resultText?: string
        sources?: AgentSource[]
        attachments?: ToolImageAttachment[]
        errorText?: string
        error?: ToolErrorPayload
        supersedeKey?: string
        gate?: ToolGateProvenance
      },
    ) {
      setTool(toolCallId, { name, ...patch })
    },
    /**
     * Drop progressively-streamed tool items that never executed (a retried turn
     * re-issues new ids, leaving stale `pending` items whose id is absent from the
     * final message).
     */
    reconcile(finalCallIds: ReadonlySet<string>) {
      const previousLength = items.length
      items = items.filter((it) => {
        if (!isToolBackedItem(it) || it.status !== 'pending') return true
        const keep = finalCallIds.has(it.toolCallId)
        if (!keep) specs.delete(it.toolCallId)
        return keep
      })
      if (items.length !== previousLength) sortedOrder = undefined
      // Positions shifted after the filter — rebuild the id→index map.
      indexById.clear()
      for (let i = 0; i < items.length; i++) indexById.set(items[i].id, i)
    },
    /** Whether any item has been accumulated. */
    get isEmpty() {
      return items.length === 0
    },
    /**
     * Drop everything — the run's assistant row was SPLIT at a mid-run steering
     * point and subsequent events accumulate into a fresh row (run/steer-split.ts).
     */
    reset() {
      items = []
      specs.clear()
      firstTextIndex.clear()
      firstReasoningIndex.clear()
      textByPart.clear()
      reasoningByPart.clear()
      indexById.clear()
      sortedOrder = undefined
    },
    /** Current ordered item list (the persisted/streamed source of truth). */
    list(): AgentItem[] {
      sortedOrder ??= items
        .map((_, index) => index)
        .sort((a, b) => {
          const turn =
            (items[a].turnIndex ?? Number.MAX_SAFE_INTEGER) -
            (items[b].turnIndex ?? Number.MAX_SAFE_INTEGER)
          return (
            turn ||
            (items[a].contentIndex ?? Number.MAX_SAFE_INTEGER) -
              (items[b].contentIndex ?? Number.MAX_SAFE_INTEGER)
          )
        })
      // Always map into a new array: flush diffing retains the previously
      // published list, so sharing or mutating one would suppress deltas.
      return sortedOrder.map((index) => items[index])
    },
  }
}
