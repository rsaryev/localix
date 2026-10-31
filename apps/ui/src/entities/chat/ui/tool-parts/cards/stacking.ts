import type { AgentItem, ToolBackedItem } from '@localixai/agent/agents'
import { hasItemError, isToolBackedItem } from '@localixai/agent/agents/items'
import { toolMeta } from './meta'

/** A run of consecutive foldable items. Pure grouping, no React. */
export interface ItemGroup {
  /** Tool name of the FIRST item — read-only groups may mix several names. */
  toolName: string
  items: ToolBackedItem[]
  /** Eligible for same-name visual collapse (stackable tool, run of >= STACK_MIN). */
  stackable: boolean
  /** A run of read-only calls (read / search / code lookups — `toolMeta().readOnly`), possibly
   *  of MIXED tool names, folded into one "Explored N locations" row. */
  readOnly: boolean
}

/** Minimum run length before a same-name stackable group collapses into a summary row. */
const STACK_MIN_COUNT = 2

/** Read-only exploration runs (reads, searches, lookups) fold at 2 calls. */
const READ_ONLY_MIN_COUNT = 2

/**
 * Bucket consecutive tool-backed items into foldable runs: read-only calls merge across tool
 * names, and consecutive calls of one stackable tool (write, edit, a mini app tool, …) merge
 * with each other.
 *
 * A call joins its group WHILE IT RUNS. It used to stand apart until it completed, so every call
 * of a run appeared as its own row and was then absorbed into the group above — one row in, one
 * row out, per call, which is the transcript jumping while the agent works. The group's summary
 * row carries the live state instead. Only a FAILED call stands alone: that is a final state, so
 * it moves once, and a failure stays visible without opening anything.
 *
 * Both kinds fold at 2 for the same reason: folding one card into a one-line summary keeps the
 * height, where a threshold of 3 showed two cards and then replaced them with one row.
 *
 * Narrative items must be filtered out by the caller (ToolChain only ever holds tool-backed runs,
 * this just narrows defensively).
 */
export function groupConsecutiveItems(items: AgentItem[]): ItemGroup[] {
  const groups: ItemGroup[] = []
  for (const item of items) {
    if (!isToolBackedItem(item)) continue
    const meta = toolMeta(item.name)
    const failed = hasItemError(item)
    const readOnly = meta.readOnly === true && !failed
    const stackable = meta.stackable && !failed
    const last = groups[groups.length - 1]
    if (readOnly && last?.readOnly) {
      last.items.push(item)
      continue
    }
    if (
      !meta.readOnly &&
      last &&
      !last.readOnly &&
      last.stackable &&
      stackable &&
      last.toolName === item.name
    ) {
      last.items.push(item)
      continue
    }
    groups.push({ toolName: item.name, items: [item], stackable, readOnly })
  }
  return groups
}

/**
 * True when a group renders as ONE collapsed summary row ({@link StackedItemGroup})
 * instead of individual cards.
 */
export function isCollapsedGroup(group: ItemGroup): boolean {
  return group.readOnly
    ? group.items.length >= READ_ONLY_MIN_COUNT
    : group.stackable && group.items.length >= STACK_MIN_COUNT
}
