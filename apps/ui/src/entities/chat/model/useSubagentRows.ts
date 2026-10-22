import { useMemo } from 'react'
import useSWR from 'swr'

import { backendClient } from '@/shared/api/client'
import { useRevalidateOnResources } from '@/shared/api/resourceGeneration'

export type SubagentRowBodies = ReadonlyMap<string, string>

const NO_BODIES: SubagentRowBodies = new Map()

/** The rows a status line answered, as id → body; an empty body hides that row. */
export function subagentRowBodies(rows: readonly { id: string; content: string }[]) {
  return new Map(rows.map((row) => [row.id, row.content]))
}

/** The SWR key of a conversation's subagent rows, or null while it has none to draw. */
export function subagentRowsKey(scopeRootId: string | null, hasSubagents: boolean) {
  return scopeRootId && hasSubagents ? `subagent-rows:${scopeRootId}` : null
}

/**
 * A plugin's `subagentStatusLine` over the subagent rows of `scopeRootId`. The server owns the
 * refresh: it redraws the rows when a subagent starts, moves or stops (and on its own tick while
 * one runs) and pokes `subagent-rows` only when they changed; this re-reads on that poke.
 */
export function useSubagentRows(
  scopeRootId: string | null,
  hasSubagents: boolean,
): SubagentRowBodies {
  const key = subagentRowsKey(scopeRootId, hasSubagents)
  useRevalidateOnResources(key ?? 'subagent-rows:none', ['subagent-rows'])
  const { data } = useSWR(key, () => backendClient.getSubagentRows(scopeRootId!))
  return useMemo(() => (data ? subagentRowBodies(data.rows) : NO_BODIES), [data])
}
