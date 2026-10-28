import { useState } from 'react'

import type { PlayerView, Shot } from '../../shared/game'

/**
 * The shots that are NEW since the board last drew — the only marks animated, in the order fired.
 * Opening a game in progress shows it at rest; a shot fired while the person watches is drawn in.
 * The result is kept until the next shot, so a re-render mid-animation (a poll, the clock) never
 * restarts it. The same rule as Tic-Tac-Toe's arriving marks.
 */
export interface Arrival {
  shot: Shot
  order: number
}

export function useShotArrivals(view: PlayerView): Arrival[] {
  const count = view.shots.length
  // State, adjusted while rendering: the first sight of a game has no arrivals.
  const [seen, setSeen] = useState<{ id: string; count: number; arrivals: Arrival[] }>({
    id: view.id,
    count,
    arrivals: [],
  })
  if (seen.id === view.id && seen.count === count) return seen.arrivals
  // First sight of a game: nothing arrives. The same game grew: the new shots arrive.
  const since = seen.id === view.id ? seen.count : count
  const arrivals = view.shots.slice(since).map((shot, order) => ({ shot, order }))
  setSeen({ id: view.id, count, arrivals })
  return arrivals
}
