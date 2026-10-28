import { useRef } from 'react'

import type { UiSession } from '@/shared/api/contracts'
import { selectActiveSession, useChatStore, type ChatStore } from './store'

/**
 * Session subscriptions for surfaces that show sessions as LIST ENTRIES (the sidebar roster, the
 * breadcrumb) and never their conversation.
 *
 * A streaming run replaces its session object on every frame — its `messages` grow — and that new
 * object lands in `allSessions`. Subscribed to the raw list, the sidebar re-sorted and re-walked
 * its whole tree and the breadcrumb rebuilt its ~200-entry menu ~50 times a second for a change
 * none of them shows. These hooks keep handing back the previous value while only BODY fields
 * differ; any summary field (title, running, unread, time, …) still changes it, by identity.
 */

/** Fields only the open conversation reads. Everything else is summary, compared by identity. */
const BODY_FIELDS = new Set<string>([
  'messages',
  'streamingMessageId',
  'activePhase',
  'lspDiagnostics',
])

export function sameSessionSummary(a: UiSession | null, b: UiSession | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!BODY_FIELDS.has(key) && left[key] !== right[key]) return false
  }
  return true
}

export function sameSessionList(a: readonly UiSession[], b: readonly UiSession[]): boolean {
  return a === b || (a.length === b.length && a.every((s, i) => sameSessionSummary(s, b[i]!)))
}

/** zustand's own `useShallow` shape (a ref holding the last answer), with a summary equality. */
function useStableSelector<T>(select: (state: ChatStore) => T, same: (a: T, b: T) => boolean) {
  const previous = useRef<{ value: T } | null>(null)
  return useChatStore((state) => {
    const next = select(state)
    if (previous.current && same(previous.current.value, next)) return previous.current.value
    previous.current = { value: next }
    return next
  })
}

/** `allSessions`, unchanged while only session bodies change. */
export function useAllSessions(): UiSession[] {
  return useStableSelector((state) => state.allSessions, sameSessionList)
}

/** The active session as a list entry: unchanged while only its body streams. */
export function useActiveSessionSummary(): UiSession | null {
  return useStableSelector(selectActiveSession, sameSessionSummary)
}
