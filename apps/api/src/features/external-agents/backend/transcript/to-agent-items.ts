/**
 * Project an external agent's transcript onto OUR native `AgentItem` model, so a foreign session
 * renders in the transcript viewer we already have instead of a second, bespoke one.
 *
 * ── EVERY foreign tool becomes a generic `tool_call` ──────────────────────────────────────────
 *
 * Never `command`, `file_change` or `mcp_call`, however obviously the foreign tool is a shell
 * command or a file edit. `ItemView` (apps/ui/src/features/chat/ui/tool-parts/ItemView.tsx)
 * dispatches on `item.type` straight into CommandCard / FileChangeCard / McpCard, and those cards
 * are written against the exact input and `details` shapes of OUR tools — `classifyTool`
 * (apps/api/src/features/chat/runtime/item-builders.ts) is the name→type map for OUR registry, and
 * it is deliberately not consulted here. Claude Code's `Bash` or `Edit` agrees with our shape by
 * coincidence at best, and the mismatch is SILENT: a card that reads `changes` off a payload that
 * has none renders an empty diff, not an error. So a foreign transcript renders as generic IN/OUT,
 * always. That is a product decision, not a fallback — and it is the same call `cli-agent-host`
 * already makes for live CLI runs, which stream every child tool use as a generic `tool_call`.
 *
 * ── IN and OUT both render, on every adapter ──────────────────────────────────────────────────
 *
 * `GenericToolCard` renders IN from `item.input` and OUT from `item.resultText`, and both are
 * filled. This block used to say only OUT could be, and listed a follow-up for each of the four
 * adapters; all five are done, and `TranscriptEvent` carries `toolName`, `toolCallId` and
 * `toolInput`. Every provider's tool calls arrive with the arguments the provider itself recorded.
 *
 * What has NOT changed is the rule that got there: arguments are read from the structured field the
 * provider wrote, and never parsed back out of flattened prose. Parsing would invent structure the
 * provider never recorded, and downstream it is indistinguishable from a real argument list.
 *
 * ── Status: `completed`, and never inferred ───────────────────────────────────────────────────
 *
 * `TranscriptEvent` carries no status or error channel, so every projected item is `completed` — a
 * historical transcript is finished by definition, and there is nothing to read for failure. We do
 * not scan text for "error"/"failed": a tool whose OUTPUT discusses an error is not a failed call,
 * and a wrong `failed` paints the card red and trips `hasItemError` for every consumer downstream.
 * When the contract grows an error channel, this is the single place that reads it.
 *
 * ── Ordering and ids ──────────────────────────────────────────────────────────────────────────
 *
 * By `ordinal` only, never by `timestamp` — the clocks are not the same instrument across (and
 * within) providers; see the ORDERING note in backend/context/compose.ts. Ids derive from the
 * session key plus that ordinal, so a windowed re-read (adapters cap events with `maxEvents`)
 * produces the SAME id for the same event, which array position would not.
 *
 * `touchedFiles` is deliberately not projected: the only slot the UI renders file paths from is
 * `FileChangeItem.changes`, i.e. exactly the specialized card the rule above forbids. `resultText`
 * is rendered with `linkify`, so paths already present in the text stay clickable; we do not
 * synthesize a file list into it.
 */

import type { AgentItem, ToolCallItem } from '@localixai/agent/agents'
import type { TranscriptEvent } from '../../shared/contracts'

/**
 * Shown only while an item is running, which a historical transcript never is. Neutral on purpose:
 * `Running` is the repo's default verb for a tool with nothing more specific to say.
 */
const ACTIVE_VERB = 'Running'

/** A `tool` event whose provider did not name the tool. Says what we know and nothing more. */
const UNNAMED_TOOL = 'tool'

/**
 * A result whose CALL is outside the window that was read.
 *
 * A tail read keeps the last N events, and a window boundary does not respect a call/result pair —
 * whatever the provider, roughly half of tail windows can open on a result whose call was evicted.
 * Before this it rendered as an ordinary tool card named `tool` with no IN row, which reads as
 * "something ran and we do not know what" rather than "the call is earlier than what you asked
 * for".
 *
 * `ordinal` is what makes the difference visible: it is the event's position in the SESSION, so a
 * first event with a non-zero ordinal proves the window starts partway in.
 */
const CALL_BEFORE_WINDOW = 'tool (call precedes this window)'

/**
 * Items one assistant message may carry before the next event opens another.
 *
 * A turn ends when the reader speaks, and a coding agent can work for a very long time without
 * being spoken to: a single message can hold hundreds or more than a thousand items, while the
 * MEDIAN message holds one. The transcript list virtualizes messages, so one such message is a
 * single row that mounts its whole run — and the chat's folding cannot help, because it keys on our
 * own tool registry and a foreign tool name falls through to a fallback that is neither read-only
 * nor stackable (a thousand identical `Bash` calls render as a thousand groups).
 *
 * Splitting is a rendering decision and changes nothing about the content: order is preserved, no
 * item is dropped, and consecutive assistant messages are what a long reply already looks like. The
 * bound is deliberately far above the median, so an ordinary turn is never split at all.
 */
const MAX_ITEMS_PER_TURN = 200

/** Fields every projected item shares, whatever its type. */
interface ItemBase {
  readonly id: string
  readonly status: 'completed'
  readonly startedAt?: number
}

/**
 * Pure projection of one session's events. `sessionKey` is the `linkKeyOf` pair — it namespaces the
 * ids so two foreign sessions rendered side by side cannot collide on a shared ordinal.
 */
export function toAgentItems(events: readonly TranscriptEvent[], sessionKey: string): AgentItem[] {
  return toTranscriptTurns(events, sessionKey).flatMap((turn) => turn.items)
}

/**
 * One speaker's uninterrupted stretch of a transcript.
 *
 * The turn boundary is what a flat item list cannot carry, and losing it costs the reader the one
 * thing a conversation is made of: who said what. Our own transcript model is messages-with-items
 * for the same reason, so a foreign session projected into turns drops straight into it.
 */
export interface TranscriptTurn {
  readonly role: 'user' | 'assistant'
  readonly items: AgentItem[]
}

/**
 * Group a session's events into turns.
 *
 * A `user` event opens a user turn and nothing else ever joins it. Everything else — assistant
 * prose, tool calls, their results, provider bookkeeping — belongs to the assistant turn in
 * progress, because that is what it is: one reply, with work inside it.
 */
export function toTranscriptTurns(
  events: readonly TranscriptEvent[],
  sessionKey: string,
): TranscriptTurn[] {
  const ordered = [...events].sort((a, b) => a.ordinal - b.ordinal)
  const nextId = idFactory(sessionKey)
  const turns: TranscriptTurn[] = []
  const byCallId = resultsByCallId(ordered)
  // A result consumed by its call must not also stand alone. Tracked as a set rather than by
  // skipping the next index, because a paired result is no longer necessarily the next event.
  const consumed = new Set<number>()
  for (let index = 0; index < ordered.length; index += 1) {
    if (consumed.has(index)) continue
    const event = ordered[index]
    const paired = resultFor(ordered, index, byCallId)
    const result = paired?.event
    if (paired) consumed.add(paired.index)
    // Only the FIRST event can have lost its call to the window boundary, and only when the window
    // does not begin at the session's start — which a non-zero ordinal is exactly the proof of.
    const opensPartway = index === 0 && event.role === 'tool' && event.ordinal > 0
    const item = itemFor(event, result, nextId(event.ordinal), opensPartway)
    const role = event.role === 'user' ? 'user' : 'assistant'
    const open = turns[turns.length - 1]
    // A user event always starts its own turn: two consecutive user messages are two things the
    // reader said, not one paragraph.
    if (open?.role === role && role === 'assistant' && open.items.length < MAX_ITEMS_PER_TURN) {
      open.items.push(item)
    } else turns.push({ role, items: [item] })
  }
  return turns
}

/** Result events by the call id they name, first occurrence winning. Built once per projection. */
function resultsByCallId(ordered: readonly TranscriptEvent[]): Map<string, number> {
  const byId = new Map<string, number>()
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]
    if (event.role !== 'tool' || !event.toolCallId) continue
    if (!byId.has(event.toolCallId)) byId.set(event.toolCallId, index)
  }
  return byId
}

/**
 * Pair a call with its result: by ID anywhere after it, by NAME only next-door.
 *
 * The distinction is the whole function. An id is exact, so adjacency adds nothing to it — while
 * requiring adjacency of an id breaks precisely the case the id exists for: an agent issuing several
 * calls before any returns. Name-matching has no such guarantee and stays next-door, because
 * matching by name across a gap attaches a result to the wrong call the moment two calls to the same
 * tool are open at once.
 *
 * When the id path was adjacency-bound too, counting cards left with NO call attached (the one
 * unambiguous signal — `resultText` falls back to the call's own text, and `completedAt` is absent
 * whenever the paired result carries no timestamp): Copilot, which really does run tools in
 * parallel, left over a third of its cards unattached, and Claude Code a few. Afterwards both are
 * 0, and Copilot's card count drops as each result folds into its call. Codex, opencode and Gemini
 * CLI were already 0 — their results happen to arrive adjacent, which is why the rule read as a
 * general design while being a bet on one event order.
 *
 * Anything unpaired stays two items. Two cards that were really one call is a cosmetic loss;
 * one card whose OUT belongs to a different call is a lie.
 */
function resultFor(
  ordered: readonly TranscriptEvent[],
  index: number,
  byCallId: ReadonlyMap<string, number>,
): { readonly event: TranscriptEvent; readonly index: number } | undefined {
  const call = ordered[index]
  if (call.role !== 'assistant' || !call.toolName) return undefined
  if (call.toolCallId) {
    const at = byCallId.get(call.toolCallId)
    // After the call, never before: a result preceding it belongs to an earlier call of the same id,
    // which is a source we do not trust to disambiguate.
    if (at === undefined || at <= index) return undefined
    return { event: ordered[at], index: at }
  }
  const next = ordered[index + 1]
  if (next?.role !== 'tool') return undefined
  // The call has no id. A result that DOES have one names a call this is not.
  if (next.toolCallId) return undefined
  return next.toolName === call.toolName ? { event: next, index: index + 1 } : undefined
}

function itemFor(
  event: TranscriptEvent,
  result: TranscriptEvent | undefined,
  id: string,
  callOutsideWindow = false,
): AgentItem {
  // The provider's wall clock lands in `startedAt` only. Mirroring one timestamp into
  // `completedAt` too would render as a measured 0 ms duration we never measured; a folded pair is
  // the one case where the source really does report both ends.
  const base: ItemBase = { id, status: 'completed', startedAt: event.timestamp }
  if (event.toolName || event.role === 'tool')
    return toolItem(event, result, base, callOutsideWindow)
  // `system` is the only role that is neither dialogue nor a tool, and the contract has no
  // reasoning flag — so it is the slot for provider bookkeeping and for the reasoning traces
  // adapters will eventually surface (codex's `agent_reasoning`, dropped today). It renders as a
  // muted strip rather than a message bubble, which is the honest weight for both. We do not sniff
  // prose for "Thinking…": that is the same fabrication as parsing arguments out of text.
  if (event.role === 'system') return { ...base, type: 'reasoning', text: event.text }
  return { ...base, type: 'text', text: event.text }
}

function toolItem(
  event: TranscriptEvent,
  result: TranscriptEvent | undefined,
  base: ItemBase,
  /** This event opens the window and the window does not start at the session's start. */
  callOutsideWindow = false,
): ToolCallItem {
  return {
    ...base,
    type: 'tool_call',
    // The item is its own call: nothing else in the transcript refers to this id, so reusing the
    // item id keeps `@call:` context-refs and React keys pointing at the same thing.
    toolCallId: base.id,
    name: event.toolName ?? (callOutsideWindow ? CALL_BEFORE_WINDOW : UNNAMED_TOOL),
    activeVerb: ACTIVE_VERB,
    // Only what the provider actually recorded. Absent stays absent — the card simply omits its IN
    // row, which is honest, whereas arguments reconstructed from prose would not be.
    ...(event.toolInput === undefined ? {} : { input: event.toolInput }),
    // When a result was folded in, its text wins: the call event's own text is the adapter's
    // placeholder for the call (`[tool: X]`), which just restates the card title. The fallback
    // keeps that placeholder rather than dropping the only text we have.
    resultText: result?.text || event.text || undefined,
    completedAt: result?.timestamp,
  }
}

/**
 * Ids key React lists and draggable `@call:` refs, so a duplicate silently merges two cards into
 * one. Ordinals are documented as unique within a session, but they are read out of untrusted
 * provider files — a repeat gets a deterministic suffix instead of a collision.
 */
function idFactory(sessionKey: string): (ordinal: number) => string {
  const taken = new Set<string>()
  return (ordinal: number) => {
    const base = `${sessionKey}#${ordinal}`
    let id = base
    for (let dup = 2; taken.has(id); dup += 1) id = `${base}.${dup}`
    taken.add(id)
    return id
  }
}
