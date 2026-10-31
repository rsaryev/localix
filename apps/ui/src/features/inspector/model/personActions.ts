import { create } from 'zustand'
import { hostLabel } from '@/shared/lib/url'
import type { PreviewEntry } from './preview'

/**
 * What the person did in a chat's Browser since the agent last read it, kept so the live "Browser
 * tabs" roster can say it: the roster alone shows the tabs as they are now, and a tab the person
 * closed or moved during a run is otherwise just missing or elsewhere, with nobody saying why.
 * Only the person's own actions are recorded (the tab strip's close, the address bar), never the
 * agent's. Process-local UI state, not a change notice: the roster is its only reader.
 */
export type PersonAction = (
  | { kind: 'closed'; tabId: string; url: string; title: string; agentOpened: boolean }
  | { kind: 'navigated'; tabId: string; url: string }
) & {
  /** When the person did it (ms since the epoch). */
  at: number
}

const KEPT = 5

/**
 * How long an action is told. The roster is read whenever a message is composed and nothing says
 * which read the agent took, so an action told once would otherwise be told on every later
 * message. A few minutes covers the turn that follows it.
 */
export const PERSON_ACTION_TTL_MS = 3 * 60_000

interface PersonActions {
  bySession: Record<string, PersonAction[]>
  closed: (sessionId: string, tab: PreviewEntry, at?: number) => void
  navigated: (sessionId: string, tab: PreviewEntry, url: string, at?: number) => void
  /** Forget the actions older than {@link PERSON_ACTION_TTL_MS}. */
  prune: (sessionId: string, now?: number) => void
}

/** Milliseconds until the oldest action is forgotten, or null when there is none. */
export function personActionsExpireIn(
  actions: readonly PersonAction[] | undefined,
  now = Date.now(),
): number | null {
  if (!actions?.length) return null
  return Math.max(0, Math.min(...actions.map((a) => a.at)) + PERSON_ACTION_TTL_MS - now)
}

function remember(
  state: Pick<PersonActions, 'bySession'>,
  sessionId: string,
  action: PersonAction,
) {
  // A tab is told once: its latest word replaces an older one.
  const rest = (state.bySession[sessionId] ?? []).filter((old) => old.tabId !== action.tabId)
  return { bySession: { ...state.bySession, [sessionId]: [...rest, action].slice(-KEPT) } }
}

export const usePersonActions = create<PersonActions>((set) => ({
  bySession: {},
  closed: (sessionId, tab, at = Date.now()) =>
    set((s) =>
      remember(s, sessionId, {
        kind: 'closed',
        tabId: tab.previewId,
        url: tab.url,
        title: tab.title ?? hostLabel(tab.url),
        agentOpened: !tab.userOpened && !!tab.originSessionId,
        at,
      }),
    ),
  navigated: (sessionId, tab, url, at = Date.now()) =>
    set((s) => remember(s, sessionId, { kind: 'navigated', tabId: tab.previewId, url, at })),
  prune: (sessionId, now = Date.now()) =>
    set((s) => {
      const kept = (s.bySession[sessionId] ?? []).filter((a) => now - a.at < PERSON_ACTION_TTL_MS)
      if (kept.length === (s.bySession[sessionId]?.length ?? 0)) return s
      const { [sessionId]: _gone, ...rest } = s.bySession
      return { bySession: kept.length ? { ...rest, [sessionId]: kept } : rest }
    }),
}))

/** The actions as plain sentences for the agent. */
export function personActionLines(actions: readonly PersonAction[] = []): string[] {
  return actions.map((action) =>
    action.kind === 'closed'
      ? `The person closed tab ${action.tabId} (${action.title}, ${action.url})${
          action.agentOpened ? ', which you opened' : ''
        }.`
      : `The person navigated tab ${action.tabId} to ${action.url}.`,
  )
}
