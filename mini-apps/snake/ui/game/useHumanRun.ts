import { useCallback, useEffect, useRef, useState } from 'react'

import { step, TICK_MS, type Direction, type Game } from '../../shared/game'

/**
 * THE PERSON'S GAME, RUN IN THE VIEW — and why it runs here.
 *
 * A snake moves every 150 ms. Asking the backend for every tick would be seven requests a second
 * per open board, and a slow answer would stutter the snake. So the view plays the ticks itself
 * with the SAME pure rules the backend has (`shared/game.ts`), and saves the headings it played in
 * batches (`saveTurns`, about every two seconds, and at once when the game ends or the pane goes
 * away). The backend replays them from the stored board with the seeded food generator, so the
 * saved board is exactly the one on screen — and the only one the rules can make.
 *
 * Nothing counts in state: how many ticks are due is DERIVED from the time the last one ran
 * (`TICK_MS` against a clock), so a slow frame plays the ticks it owes rather than slowing the
 * snake, and a hidden pane — which stops the run — loses nothing but the pause.
 *
 * The snake waits for the first arrow key; turns pressed between two ticks queue (at most two), so
 * a quick "up, left" is two turns instead of the last key winning.
 */

/** Ticks per save: about two seconds of play. */
export const SAVE_TICKS = 13
/** How often the view checks whether a tick is due. */
const FRAME_MS = 16

interface Run {
  game: Game
  lastTickAt: number
  queue: Direction[]
  unsaved: Direction[]
  savedTick: number
}

export function useHumanRun(input: {
  stored: Game | null
  /** The person's board, the game on, the pane shown. */
  enabled: boolean
  saveTurns: (fromTick: number, headings: readonly Direction[]) => Promise<Game | null>
}) {
  const { stored, enabled, saveTurns } = input
  const run = useRef<Run | null>(null)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const [shown, setShown] = useState<Game | null>(null)

  /** Save what was played since the last save; saves go out one after another, in order. */
  const save = useCallback(() => {
    const current = run.current
    if (!current || current.unsaved.length === 0) return
    const fromTick = current.savedTick
    const headings = current.unsaved
    current.unsaved = []
    current.savedTick += headings.length
    saving.current = saving.current.then(async () => {
      // A refused save (another tab moved the board, a new game began) ends this run: the stored
      // board, with the route's reason, takes over.
      if ((await saveTurns(fromTick, headings)) === null && run.current) {
        run.current = null
        setShown(null)
      }
    })
  }, [saveTurns])

  const finish = useCallback(() => {
    save()
    run.current = null
    // The stored board takes over once the last save answered.
    void saving.current.then(() => setShown(null))
  }, [save])

  const steer = useCallback(
    (direction: Direction) => {
      if (!enabled || stored?.status !== 'playing') return
      if (!run.current) {
        run.current = {
          game: stored,
          lastTickAt: performance.now(),
          queue: [direction],
          unsaved: [],
          savedTick: stored.tick,
        }
        setShown(stored)
        return
      }
      const { queue } = run.current
      if (queue.length < 2 && queue.at(-1) !== direction) queue.push(direction)
    },
    [enabled, stored],
  )

  useEffect(() => {
    if (!enabled) {
      if (run.current) finish()
      return
    }
    const timer = setInterval(() => {
      const current = run.current
      if (!current) return
      const due = Math.floor((performance.now() - current.lastTickAt) / TICK_MS)
      if (due <= 0) return
      for (let i = 0; i < due && current.game.status === 'playing'; i++) {
        const heading = current.queue.shift() ?? current.game.heading
        current.game = step(current.game, heading)
        current.unsaved.push(heading)
        current.lastTickAt += TICK_MS
      }
      setShown(current.game)
      if (current.game.status !== 'playing') finish()
      else if (current.unsaved.length >= SAVE_TICKS) save()
    }, FRAME_MS)
    return () => clearInterval(timer)
  }, [enabled, finish, save])

  // Leaving the view saves what was played.
  useEffect(() => () => save(), [save])

  // `shown` is set whenever a run exists and cleared only after it has ended and been saved.
  return { game: shown ?? stored, running: shown !== null, steer }
}
