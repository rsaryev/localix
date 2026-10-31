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
export type PersonAction =
  | { kind: 'closed'; tabId: string; url: string; title: string; agentOpened: boolean }
  | { kind: 'navigated'; tabId: string; url: string }

const KEPT = 5

interface PersonActions {
  bySession: Record<string, PersonAction[]>
  closed: (sessionId: string, tab: PreviewEntry) => void
  navigated: (sessionId: string, tab: PreviewEntry, url: string) => void
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
  closed: (sessionId, tab) =>
    set((s) =>
      remember(s, sessionId, {
        kind: 'closed',
        tabId: tab.previewId,
        url: tab.url,
        title: tab.title ?? hostLabel(tab.url),
        agentOpened: !tab.userOpened && !!tab.originSessionId,
      }),
    ),
  navigated: (sessionId, tab, url) =>
    set((s) => remember(s, sessionId, { kind: 'navigated', tabId: tab.previewId, url })),
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
