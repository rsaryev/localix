import { create, type StoreApi, type UseBoundStore } from 'zustand'

/** How long a tab keeps saying "the agent is here" after its last command answered. */
export const AGENT_LINGER_MS = 1500

interface Entry {
  /** Commands claimed and not yet answered. */
  busy: number
  /** Bumped by every claim, so a timer armed by an earlier reply can tell it is stale. */
  epoch: number
  /** Answered, and still inside the linger. */
  lingering: boolean
}

export interface AgentPresence {
  /** Native tab id -> what the agent is doing in it. Absent means idle. */
  tabs: Record<string, Entry>
  /** The agent claimed a command for this tab. */
  begin: (tabId: string) => void
  /** That command answered (or failed). */
  end: (tabId: string) => void
  /** The tab is gone. */
  forget: (tabId: string) => void
}

/** Starts a timer and returns how to cancel it; injected so tests never wait. */
export type Schedule = (run: () => void, ms: number) => () => void

const realSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

export const isAgentWorking = (tabs: AgentPresence['tabs'], tabId: string): boolean => {
  const entry = tabs[tabId]
  return !!entry && (entry.busy > 0 || entry.lingering)
}

/**
 * What the person may see of the agent in a native tab: idle, or working from a command's claim
 * until a short moment after its reply. Presence is the browser's own view state; it is never a
 * place another surface writes to.
 */
export function createAgentPresence(
  schedule: Schedule = realSchedule,
): UseBoundStore<StoreApi<AgentPresence>> {
  const cancels = new Map<string, () => void>()
  return create<AgentPresence>((set, get) => ({
    tabs: {},
    begin: (tabId) => {
      cancels.get(tabId)?.()
      cancels.delete(tabId)
      set((s) => {
        const entry = s.tabs[tabId]
        return {
          tabs: {
            ...s.tabs,
            [tabId]: {
              busy: (entry?.busy ?? 0) + 1,
              epoch: (entry?.epoch ?? 0) + 1,
              lingering: false,
            },
          },
        }
      })
    },
    end: (tabId) => {
      const entry = get().tabs[tabId]
      if (!entry) return
      const busy = Math.max(0, entry.busy - 1)
      set((s) => ({ tabs: { ...s.tabs, [tabId]: { ...entry, busy, lingering: busy === 0 } } }))
      if (busy > 0) return
      cancels.get(tabId)?.()
      cancels.set(
        tabId,
        schedule(() => {
          cancels.delete(tabId)
          const now = get().tabs[tabId]
          if (!now || now.epoch !== entry.epoch || now.busy > 0) return
          get().forget(tabId)
        }, AGENT_LINGER_MS),
      )
    },
    forget: (tabId) => {
      cancels.get(tabId)?.()
      cancels.delete(tabId)
      set((s) => {
        if (!(tabId in s.tabs)) return s
        const { [tabId]: _gone, ...rest } = s.tabs
        return { tabs: rest }
      })
    },
  }))
}

export const useAgentPresence = createAgentPresence()
