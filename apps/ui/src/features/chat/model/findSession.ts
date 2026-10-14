// "Find a session anywhere" — look in the working `sessions` list first, then fall
// back to the full `allSessions` roster (which also holds sub-agent / background /
// not-currently-open sessions). Centralised so every lookup applies the SAME
// precedence; generic over the session shape so it needs no store-type import.

import { getLiveSessionBody } from './sessionListHelpers'

export function findSessionInState<T extends { id: string }>(
  state: { sessions: readonly T[]; allSessions: readonly T[] },
  id: string | null | undefined,
): T | undefined {
  if (!id) return undefined
  const live = getLiveSessionBody(id) as unknown as T | undefined
  if (live) return live
  return state.sessions.find((s) => s.id === id) ?? state.allSessions.find((s) => s.id === id)
}
