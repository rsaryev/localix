import { useMemo } from 'react'
import { databaseApi } from '../../api/databaseApi'
import { engineProblemRanges, type EngineProblemRange } from './engine-check'

function createEngineCheck(connectionId: string): (sql: string) => Promise<EngineProblemRange[]> {
  let inflight: AbortController | null = null
  return async (sql: string) => {
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller
    try {
      return engineProblemRanges(
        sql,
        await databaseApi.validate(connectionId, sql, controller.signal),
      )
    } catch {
      return []
    } finally {
      if (inflight === controller) inflight = null
    }
  }
}

/**
 * The connection's compile-only check as one stable function per connection, for the editors'
 * diagnostics. A newer check aborts the older request: while the user types, only the answer for
 * the latest text matters, and an abandoned request must not hold the engine's queue.
 * A transport failure marks nothing — an unreachable validator is not a SQL error.
 */
export function useEngineCheck(
  connectionId: string | undefined,
): ((sql: string) => Promise<EngineProblemRange[]>) | null {
  return useMemo(() => (connectionId ? createEngineCheck(connectionId) : null), [connectionId])
}
