import { useEffect, useReducer, useState } from 'react'
import type { ModBandPage } from '@/shared/api/modsApi'

/**
 * Which page of the band above the prompt box shows (`ModBand.tsx`). A band has pages when a mod's
 * drawing hid the mods after it (the API's `band-pages.ts`); the first is what Claude Code draws.
 *
 * A page the person picks stays for this chat, across redraws, until that page is gone. Until
 * they pick one, the band may turn to the next page every `ROTATE_MS` — only while nothing holds
 * it: rotation on, more than one page, not paused (hover, focus, typing, collapsed) and no turn
 * running. Any activity in the composer (`activity`) starts the wait again.
 */

/** How long a page shows before the band turns to the next, while it may. */
export const ROTATE_MS = 8000

/** Runs `run` after `ms`; returns a cancel. Injected by tests, which never wait. */
export type Schedule = (run: () => void, ms: number) => () => void

const afterDelay: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

/** A page by the mods that drew it: the same page across redraws, gone when they stop. */
const keyOf = (page: ModBandPage) => page.mods.join('\u0000')

/** The page each chat's person picked, by chat; held while the tab lives. */
const picked = new Map<string, string>()

export interface BandPagesOptions {
  sessionId: string
  pages: readonly ModBandPage[]
  /** The person's setting, reduced motion already applied. */
  rotate: boolean
  /** Something holds the page still: hover, focus, typing, a running turn, the band collapsed. */
  paused: boolean
  /** Grows with each keystroke in the composer: the wait starts again. */
  activity: number
  schedule?: Schedule
}

export function useBandPages({
  sessionId,
  pages,
  rotate,
  paused,
  activity,
  schedule = afterDelay,
}: BandPagesOptions) {
  const [turned, setTurned] = useState(0)
  const [, refresh] = useReducer((count: number) => count + 1, 0)
  const count = pages.length
  const pick = picked.get(sessionId)
  const pickedAt = pick === undefined ? -1 : pages.findIndex((page) => keyOf(page) === pick)
  const index = pickedAt >= 0 ? pickedAt : Math.min(turned, Math.max(0, count - 1))

  // A picked page that is gone frees the band to turn again.
  useEffect(() => {
    if (pick !== undefined && pickedAt < 0 && count > 0) picked.delete(sessionId)
  }, [pick, pickedAt, count, sessionId])

  const turns = rotate && !paused && count > 1 && pickedAt < 0
  useEffect(() => {
    if (!turns) return
    return schedule(() => setTurned((index + 1) % count), ROTATE_MS)
  }, [turns, index, count, activity, schedule])

  /** The person shows page `to`: it stays for this chat. */
  const choose = (to: number) => {
    const page = pages[((to % count) + count) % count]
    if (!page) return
    picked.set(sessionId, keyOf(page))
    setTurned(pages.indexOf(page))
    refresh()
  }
  return { index, count, choose, step: (by: number) => choose(index + by) }
}
