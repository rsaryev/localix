import { create } from 'zustand'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { dayLabel, localDayStart } from '@/shared/lib/calendarDay'
import { readableAddress } from './previewAddress'

const STORAGE_KEY = 'browser_history_v1'
const MAX_VISITS = 150

export interface BrowserVisit {
  url: string
  title?: string
  visitedAt: number
}

export function addBrowserVisit(
  visits: BrowserVisit[],
  url: string,
  title?: string,
  now = Date.now(),
): BrowserVisit[] {
  if (!/^https?:\/\//.test(url)) return visits
  const previous = visits.find((visit) => visit.url === url)
  return [
    { url, title: title || previous?.title, visitedAt: now },
    ...visits.filter((visit) => visit.url !== url),
  ].slice(0, MAX_VISITS)
}

/**
 * A visit as a reader names it: its title, with the readable address only when that says more.
 * A page the app never learned a title for (a framed page's document is often out of its reach)
 * is named by its address alone, rather than by the same address twice.
 */
export function visitName(visit: BrowserVisit): { title: string; address?: string } {
  const address = readableAddress(visit.url)
  const title = visit.title?.trim()
  return title && title !== address ? { title, address } : { title: address }
}

export interface BrowserHistoryDay {
  /** Midnight opening the day: its key. */
  start: number
  label: string
  visits: BrowserVisit[]
}

/**
 * The visits cut into the local days they happened on, each day once, in the order the visits
 * came — so a newest-first history reads as today, yesterday, then back through the dates.
 */
export function historyDays(
  visits: readonly BrowserVisit[],
  now: Date = new Date(),
): BrowserHistoryDay[] {
  const days = new Map<number, BrowserHistoryDay>()
  for (const visit of visits) {
    const start = localDayStart(new Date(visit.visitedAt))
    const day = days.get(start)
    if (day) day.visits.push(visit)
    else days.set(start, { start, label: dayLabel(new Date(start), now), visits: [visit] })
  }
  return [...days.values()]
}

/**
 * App-wide on purpose, unlike the tabs. A visit is a fact about the PERSON — a page they read —
 * not content a chat produced, the way a browser profile's history spans its windows. Split per
 * chat, "the page I had open yesterday" would vanish depending on which chat the History tab was
 * opened from. What stays per chat is where it opens: an entry opens in the Browser of the chat
 * whose History tab it was picked from (`BrowserWorkspace`'s `open`).
 */
interface BrowserHistoryStore {
  visits: BrowserVisit[]
  record: (url: string, title?: string) => void
  remove: (urls: string[]) => number
  clear: () => void
}

const restored = loadJSON<BrowserVisit[]>(STORAGE_KEY)

export const useBrowserHistory = create<BrowserHistoryStore>((set, get) => ({
  visits: Array.isArray(restored)
    ? restored.filter(
        (visit) =>
          typeof visit?.url === 'string' &&
          /^https?:\/\//.test(visit.url) &&
          typeof visit.visitedAt === 'number' &&
          Number.isFinite(visit.visitedAt),
      )
    : [],
  record: (url, title) => set((state) => ({ visits: addBrowserVisit(state.visits, url, title) })),
  remove: (urls) => {
    const targets = new Set(urls)
    const before = get().visits.length
    set((state) => ({ visits: state.visits.filter((visit) => !targets.has(visit.url)) }))
    return before - get().visits.length
  },
  clear: () => set({ visits: [] }),
}))

useBrowserHistory.subscribe((state) => saveJSON(STORAGE_KEY, state.visits))
