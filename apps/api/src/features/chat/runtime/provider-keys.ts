/**
 * Shared key-selection idiom for provider connections. The run path, the aux/
 * title/improve-prompt slots, and the media paths all pick the SAME way:
 * the highest-priority ENABLED key (lower `priority` wins). Centralized here so
 * the selection order is defined once; each caller keeps its own miss policy
 * (throw vs. return null), since those differ by call site.
 *
 * There is intentionally no rotation / failover — see model-selection.ts.
 */

/** The minimal shape these selectors need from a connection key. */
type PriorityKey = { enabled: boolean; priority: number }

/** Enabled keys, lowest `priority` first. */
export function enabledKeysByPriority<K extends PriorityKey>(keys: readonly K[]): K[] {
  return [...keys].filter((k) => k.enabled).sort((a, b) => a.priority - b.priority)
}

/** The single highest-priority enabled key, or `undefined` when none are enabled. */
export function firstEnabledKey<K extends PriorityKey>(keys: readonly K[]): K | undefined {
  return enabledKeysByPriority(keys)[0]
}
