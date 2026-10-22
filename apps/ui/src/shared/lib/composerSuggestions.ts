import { useSyncExternalStore } from 'react'
import { createEventChannel } from './eventChannel'

/**
 * A suggestion an extension offers for a conversation's empty prompt box — a Claude Code mod's
 * `$.prompt.suggest` — shown as the box's ghost text, Tab to take. Kept in `shared` so the
 * composer (an entity) reads what a feature offers without importing it.
 */

export interface ComposerSuggestion {
  text: string
  /** Called once the person took it or the box no longer wants it. */
  settle: () => void
}

const offered = new Map<string, ComposerSuggestion>()
const channel = createEventChannel<[sessionId: string]>()

export function offerComposerSuggestion(sessionId: string, suggestion: ComposerSuggestion | null) {
  if (suggestion) offered.set(sessionId, suggestion)
  else offered.delete(sessionId)
  channel.publish(sessionId)
}

/** The suggestion offered for a conversation, until it is taken or withdrawn. */
export function useComposerSuggestion(sessionId: string | null): ComposerSuggestion | null {
  return useSyncExternalStore(
    (notify) => channel.subscribe((changed) => changed === sessionId && notify()),
    () => (sessionId ? (offered.get(sessionId) ?? null) : null),
  )
}
