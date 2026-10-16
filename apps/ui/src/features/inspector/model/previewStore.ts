// Standalone preview store: each chat's Browser content (active page + open tabs) shown inside
// that chat's Browser WorkItem. The grid owns the TAB, this owns the CONTENT. Thin wrappers over
// the pure reducers in preview.ts.
//
// Keyed by the chat the Browser belongs to. It used to be ONE strip under a fixed `@browser`
// key, rendered by every chat's Browser tab: a page opened in chat A appeared in chat B's
// Browser, B's agent saw A's pages in its tab roster, and closing "all tabs" in one chat closed
// the other's. Every action here names the session whose strip it changes.
//
// A strip is a WORKSPACE's (`workspaceOf`): an action naming a sub-session changes its root's
// strip, the one its root's Browser tab shows, and the entry remembers the session that opened it
// (`originSessionId`). Only `discardSessionPreview` takes its id as is — deleting a sub-session
// must never discard the strip of the conversation it belongs to.
import { create } from 'zustand'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { workspaceStorageKey } from '@/shared/lib/workspaceWindow'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import { previewHostKey, usePreviewHosts } from './previewHosts'
import { useBrowserHistory } from './browserHistory'
import { BROWSER_HISTORY_URL } from './browserUrl'
import {
  recordPreview,
  activatePreview,
  closeTab as closeTabReducer,
  discardSessionPreviews,
  repointPreview,
  type PreviewEntry,
  type PreviewMaps,
} from './preview'

export type { PreviewEntry } from './preview'

// v2: per-session strips. The v1 single shared strip is not migrated — its tabs carry no
// reliable owner, and guessing one would hand a page to the wrong chat.
const STORAGE_KEY = workspaceStorageKey('browser_tabs_v2')

function restoredState(): PreviewMaps {
  const saved = loadJSON<PreviewMaps>(STORAGE_KEY)
  return {
    previewBySession: saved?.previewBySession ?? {},
    previewTabsBySession: saved?.previewTabsBySession ?? {},
  }
}

/** Replace one tab of one session's strip, keeping the active entry in step with it. */
function patchTab(
  s: PreviewMaps,
  sessionId: string,
  previewId: string,
  patch: (entry: PreviewEntry) => PreviewEntry,
): Partial<PreviewMaps> {
  const tabs = s.previewTabsBySession[sessionId] ?? []
  const found = tabs.find((tab) => tab.previewId === previewId)
  if (!found) return {}
  const next = patch(found)
  const active = s.previewBySession[sessionId]
  return {
    previewTabsBySession: {
      ...s.previewTabsBySession,
      [sessionId]: tabs.map((tab) => (tab.previewId === previewId ? next : tab)),
    },
    previewBySession:
      active?.previewId === previewId
        ? { ...s.previewBySession, [sessionId]: next }
        : s.previewBySession,
  }
}

interface PreviewStore extends PreviewMaps {
  setPreviewViewport: (
    sessionId: string,
    previewId: string,
    viewport: PreviewEntry['viewport'],
    byAgent?: boolean,
  ) => void
  /** A run ended: every tab an agent pinned to a size in this workspace fits the pane again. */
  resetAgentViewports: (sessionId: string) => void
  /** Record a freshly-opened/updated preview into the session's strip (active + open tab). */
  recordPreview: (sessionId: string, entry: PreviewEntry) => void
  /** Switch the session's active tab. */
  setActivePreview: (sessionId: string, previewId: string) => void
  /** Re-point the session's active static preview at a freshly re-served URL (bumps version). */
  repointActivePreview: (sessionId: string, url: string, previewId: string) => void
  /** Permanently remove a deleted session's strip, persisted tabs included. */
  discardSessionPreview: (sessionId: string) => void
  /** Open a page the person browsed to as a new tab of the session's Browser. */
  openBrowserTab: (sessionId: string, url: string) => string
  /** Reveal (or open) the History tab in the session's Browser. */
  openBrowserHistory: (sessionId: string) => string
  updateBrowserTab: (sessionId: string, previewId: string, patch: Partial<PreviewEntry>) => void
  /**
   * Close tabs by id. A tab id is a UUID minted for one tab of one chat, so it names its strip
   * without a session — which is what the agent's `preview.closed` event carries.
   */
  closeBrowserTabs: (previewIds: string[]) => void
  /** Move a tab before another one of the same strip, or to its end when `beforeId` is null. */
  moveBrowserTab: (sessionId: string, previewId: string, beforeId: string | null) => void
}

const init = restoredState()

export const usePreviewStore = create<PreviewStore>((set, get) => ({
  previewBySession: init.previewBySession,
  previewTabsBySession: init.previewTabsBySession,

  setPreviewViewport: (session, previewId, viewport, byAgent) =>
    set((s) =>
      patchTab(s, workspaceOf(session), previewId, (entry) => ({
        ...entry,
        viewport,
        agentViewport: byAgent && viewport ? true : undefined,
      })),
    ),
  resetAgentViewports: (session) =>
    set((s) => {
      const sessionId = workspaceOf(session)
      let next: PreviewMaps = s
      for (const tab of s.previewTabsBySession[sessionId] ?? []) {
        if (!tab.agentViewport) continue
        next = {
          ...next,
          ...patchTab(next, sessionId, tab.previewId, (entry) => ({
            ...entry,
            viewport: null,
            agentViewport: undefined,
          })),
        }
      }
      return next === s ? {} : next
    }),

  recordPreview: (session, entry) => {
    useBrowserHistory.getState().record(entry.url, entry.title)
    // The opener stays the one that first recorded it: a re-record from the workspace's Browser
    // (`usePreviewViewport`) must not hand a sub-agent's page to its root.
    set((s) =>
      recordPreview(s, workspaceOf(session), {
        ...entry,
        originSessionId: entry.originSessionId ?? session,
      }),
    )
  },
  setActivePreview: (session, previewId) =>
    set((s) => {
      const previewBySession = activatePreview(s, workspaceOf(session), previewId)
      return previewBySession ? { previewBySession } : {}
    }),
  repointActivePreview: (session, url, _previewId) =>
    set((s) => {
      const sessionId = workspaceOf(session)
      const cur = s.previewBySession[sessionId]
      if (!cur) return {}
      const next: PreviewEntry = { ...cur, url, version: cur.version + 1 }
      return repointPreview(s, sessionId, next) ?? {}
    }),
  discardSessionPreview: (sessionId) => set((s) => discardSessionPreviews(s, sessionId) ?? {}),
  openBrowserTab: (session, url) => {
    const previewId = crypto.randomUUID()
    useBrowserHistory.getState().record(url)
    set((s) =>
      recordPreview(s, workspaceOf(session), {
        previewId,
        url,
        version: 0,
        userOpened: true,
        nativePage: true,
      }),
    )
    return previewId
  },
  openBrowserHistory: (session) => {
    const sessionId = workspaceOf(session)
    const existing = get().previewTabsBySession[sessionId]?.find(
      (tab) => tab.url === BROWSER_HISTORY_URL,
    )
    if (existing) {
      set((s) => ({
        previewBySession: activatePreview(s, sessionId, existing.previewId) ?? s.previewBySession,
      }))
      return existing.previewId
    }
    const previewId = crypto.randomUUID()
    set((s) =>
      recordPreview(s, sessionId, {
        previewId,
        url: BROWSER_HISTORY_URL,
        title: 'History',
        version: 0,
        userOpened: true,
      }),
    )
    return previewId
  },
  updateBrowserTab: (session, previewId, patch) => {
    const sessionId = workspaceOf(session)
    const current = get().previewTabsBySession[sessionId]?.find(
      (tab) => tab.previewId === previewId,
    )
    if (current && (patch.url || patch.title)) {
      useBrowserHistory.getState().record(patch.url ?? current.url, patch.title)
    }
    set((s) => patchTab(s, sessionId, previewId, (entry) => ({ ...entry, ...patch, previewId })))
  },
  closeBrowserTabs: (previewIds) =>
    set((s) => {
      let next: PreviewMaps = s
      for (const id of previewIds) {
        const owner = Object.keys(next.previewTabsBySession).find((sessionId) =>
          next.previewTabsBySession[sessionId]?.some((tab) => tab.previewId === id),
        )
        const result = owner ? closeTabReducer(next, owner, id) : null
        if (result) next = { ...next, ...result }
      }
      return next === s ? {} : next
    }),
  moveBrowserTab: (session, previewId, beforeId) =>
    set((s) => {
      const sessionId = workspaceOf(session)
      const tabs = s.previewTabsBySession[sessionId] ?? []
      const moving = tabs.find((tab) => tab.previewId === previewId)
      if (!moving || previewId === beforeId) return {}
      const rest = tabs.filter((tab) => tab.previewId !== previewId)
      const at = beforeId === null ? -1 : rest.findIndex((tab) => tab.previewId === beforeId)
      const ordered = at < 0 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)]
      return { previewTabsBySession: { ...s.previewTabsBySession, [sessionId]: ordered } }
    }),
}))

usePreviewStore.subscribe((s) => {
  const open = new Set(
    Object.entries(s.previewTabsBySession).flatMap(([sessionId, entries]) =>
      entries.map((entry) => previewHostKey(sessionId, entry.previewId)),
    ),
  )
  for (const key of Object.keys(usePreviewHosts.getState().live)) {
    if (!open.has(key)) usePreviewHosts.getState().closed(key)
  }
  saveJSON(STORAGE_KEY, {
    previewBySession: s.previewBySession,
    previewTabsBySession: s.previewTabsBySession,
  })
})
