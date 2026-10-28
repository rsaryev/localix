import { useEffect, useRef, useState } from 'react'

/**
 * WHERE EACH SEGMENT IS DRAWN BETWEEN TWO TICKS — the snake's motion, kept apart from its rules.
 *
 * The rules move the snake a whole cell per tick (`shared/game.ts`); drawn that way it jumps. So
 * the view keeps the cells it drew last and eases every segment from there to its new cell over
 * `durationMs`: progress = (now − the moment the step arrived) / durationMs, clamped, read on each
 * animation frame. A segment that is new this step (the snake grew) starts where the old tail
 * was, so the tail stays put while the body lengthens. Nothing counts frames: each animation frame
 * stores its timestamp and progress is derived from it, so a dropped frame lands where it should
 * rather than late.
 *
 * The person's snake glides over one whole tick, so its motion is continuous. The model's steps
 * arrive irregularly from the backend, so each one glides over a short fixed duration instead of
 * the gap before it. A person who asked for reduced motion sees each step snap into place.
 */

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A point of the drawn snake, in cell units (the centre of cell (r, c) is (c + .5, r + .5)). */
export interface Point {
  x: number
  y: number
}

export const centre = (cell: number, size: number): Point => ({
  x: (cell % size) + 0.5,
  y: Math.floor(cell / size) + 0.5,
})

/**
 * Each segment `progress` (0–1) of the way from where it was drawn (`from`) to its cell. A segment
 * new this step (the snake grew) starts where the old tail was drawn, so the tail stays put.
 */
export function glidePoints(
  from: readonly Point[],
  cells: readonly number[],
  progress: number,
  size: number,
): Point[] {
  return cells.map((cell, index) => {
    const end = centre(cell, size)
    const start = from[index] ?? from[from.length - 1] ?? end
    return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress }
  })
}

/** One step's glide: where it began, and the last animation frame it was drawn at. */
interface Glide {
  key: string
  snake: readonly number[]
  from: Point[]
  /** The clock when the glide began; null until its first frame (the step is still at `from`). */
  startedAt: number | null
  /** The clock at the last frame. */
  now: number
}

const progressOf = (glide: Glide, durationMs: number, instant: boolean) =>
  instant
    ? 1
    : glide.startedAt === null
      ? 0
      : Math.min(1, Math.max(0, (glide.now - glide.startedAt) / durationMs))

export function useGlide(snake: readonly number[], size: number, durationMs: number): Point[] {
  const key = snake.join(',')
  const instant = durationMs <= 0 || reducedMotion()
  const [glide, setGlide] = useState<Glide>(() => ({
    key,
    snake,
    from: snake.map((cell) => centre(cell, size)),
    startedAt: null,
    now: 0,
  }))
  // The clock, read in the effect that starts a step — never while rendering.
  const began = useRef<{ key: string; at: number } | null>(null)

  // A new step: glide from where every segment is drawn NOW. Decided while rendering, so the first
  // frame of the step is already its starting position, never a jump.
  let current = glide
  if (glide.key !== key) {
    const from = glidePoints(glide.from, glide.snake, progressOf(glide, durationMs, instant), size)
    current = { key, snake, from, startedAt: null, now: 0 }
    setGlide(current)
  }

  useEffect(() => {
    if (instant) return
    if (began.current?.key !== key) began.current = { key, at: performance.now() }
    const startedAt = began.current.at
    let frame = 0
    const tick = (now: number) => {
      setGlide((previous) => (previous.key === key ? { ...previous, startedAt, now } : previous))
      if (now - startedAt < durationMs) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [key, durationMs, instant])

  return glidePoints(current.from, snake, progressOf(current, durationMs, instant), size)
}
