import { mergeSource, type AgentItem, type AgentSource } from '@localixai/agent/agents'
import { isToolBackedItem } from '@localixai/agent/agents/items'

/**
 * The session's source registry — everything the agent looked at across the whole conversation,
 * not just under one answer.
 *
 * DERIVED, deliberately. There is no table, no route, no WS event and no new persistence field:
 * the records already live in `agent_messages.payload_json.items[].sources`, and the
 * context-system document rejects "a second contextRefs/contextCapture/plugin-source-card/MCP-
 * source persistence field" by name. Recomputing from the messages the store already holds costs
 * one pass over an array that is already in memory, and cannot go stale against the transcript
 * because it IS the transcript.
 *
 * Reconciliation uses the SAME `mergeSource` the tool-result boundary uses. This module used to be
 * a shortened copy in the UI; sharing it is what makes "the same source seen twice" mean the same
 * thing on both sides.
 */

/** One source, plus where in the conversation it was seen. */
export interface SessionSource extends AgentSource {
  /** Messages whose items carried this source, in first-appearance order. */
  messageIds: string[]
  /** How many separate observations merged into this row. */
  count: number
}

/** A message as this module needs it — id plus items. Structural, so tests need no store. */
export interface SourceBearingMessage {
  id: string
  items?: readonly AgentItem[] | undefined
}

/**
 * Kinds whose identity is the FILE, not the position inside it.
 *
 * A `symbol` is deliberately absent: two symbols in one file are two different things, and the line
 * is what tells them apart. A file read and the same file matched by a search are one thing.
 */
const POSITION_AGNOSTIC_KINDS = new Set(['file', 'document'])

/**
 * Dedupe identity: kind AND uri, with the line dropped for kinds where it is a destination rather
 * than an identity.
 *
 * That exception is not cosmetic. `search` publishes `…/file?path=X&line=7` and `read` publishes
 * `…/file?path=X`, so keying on the raw URI gave the most common sequence an agent performs —
 * search a file, then read it — TWO rows for one file, and `mergeSource`'s role upgrade never fired
 * because the rows never met. The drawer then showed a file the agent had read sitting in the
 * "found or failed" set, still labelled as merely discovered.
 *
 * The line stays ON the surviving row's uri: `mergeSource` keeps the first-seen one, so a file found
 * by a search and later read still opens at the matching line, which is the more useful place.
 */
export const sourceKey = (source: AgentSource) => {
  if (!POSITION_AGNOSTIC_KINDS.has(source.kind)) return `${source.kind}\0${source.uri}`
  const cut = source.uri.indexOf('&line=')
  return `${source.kind}\0${cut === -1 ? source.uri : source.uri.slice(0, cut)}`
}
const keyOf = sourceKey

/**
 * Every source in the conversation, deduplicated, in the order each was FIRST seen.
 *
 * First-appearance order rather than recency: the list reads as a trail of what the agent did, and
 * a list that reshuffles as new observations arrive cannot be scanned twice for the same thing.
 *
 * Nothing is filtered here — `discovered` and `failed` records are included and labelled. The
 * ANSWER surface excludes them (that is a change-gate requirement); a registry that dropped them
 * could not offer them behind an explicit toggle, and "what did you look at" honestly includes the
 * files you searched and the reads that failed.
 */
export function collectSessionSources(
  messages: readonly SourceBearingMessage[] | undefined,
): SessionSource[] {
  const byKey = new Map<string, SessionSource>()
  for (const message of messages ?? []) {
    for (const item of message.items ?? []) {
      if (!isToolBackedItem(item)) continue
      for (const source of item.sources ?? []) {
        const key = keyOf(source)
        const current = byKey.get(key)
        if (!current) {
          byKey.set(key, { ...source, messageIds: [message.id], count: 1 })
          continue
        }
        const merged = mergeSource(current, source)
        byKey.set(key, {
          ...merged,
          // A message is listed once however many of its items carried the source: the affordance
          // is "jump to where this came up", and the same message twice is not a second place.
          messageIds: current.messageIds.includes(message.id)
            ? current.messageIds
            : [...current.messageIds, message.id],
          count: current.count + 1,
        })
      }
    }
  }
  return [...byKey.values()]
}

/**
 * The subset that belongs UNDER an answer: read and cited evidence only.
 *
 * A search hit and a failed read stay in the tool card and in the session registry, but must never
 * appear beneath an answer as if they informed it — `docs/internals/subsystems/context-system.md`
 * §9 rejects "treating discovery snippets as consulted evidence", and §10 makes excluding them an
 * acceptance criterion.
 */
export function answerSources(sources: readonly AgentSource[]): AgentSource[] {
  return sources.filter((source) => source.status === 'available' && source.role !== 'discovered')
}

/**
 * What ONE message contributed at answer grade — the evidence that message itself read or cited.
 *
 * Deliberately computed from that message alone. The session registry merges by `sourceKey` and
 * `mergeSource` UPGRADES the role to the strongest observation anywhere in the conversation, so a
 * file that one answer merely found and a later one read becomes a single `consulted` row carrying
 * both message ids. Asking the registry "what did this answer consult" therefore answers with the
 * other answer's reading — which is precisely the claim
 * `docs/internals/subsystems/context-system.md` §9 forbids.
 */
export function answerSourcesOfMessage(message: SourceBearingMessage): AgentSource[] {
  return answerSources(collectSessionSources([message]))
}

/**
 * Group for presentation so web, file, and other provenance remain distinct; grouping reduces
 * the scan cost as the registry grows.
 *
 * Groups appear in the order their first member was seen, so the grouping never reorders the trail
 * it is grouping.
 */
export function sourceKindGroups<T extends AgentSource>(
  sources: readonly T[],
): { kind: string; sources: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const source of sources) {
    const existing = groups.get(source.kind)
    if (existing) existing.push(source)
    else groups.set(source.kind, [source])
  }
  return [...groups].map(([kind, items]) => ({ kind, sources: items }))
}
