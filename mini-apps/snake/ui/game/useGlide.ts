import { useEffect, useRef, useState } from 'react'

/**
 * WHERE EACH SEGMENT IS DRAWN BETWEEN TWO TICKS — the snake's motion, kept apart from its rules.
 *
 * The rules move the snake a whole cell per tick (`shared/game.ts`); drawn that way it jumps. So
 * the view keeps the cells it drew last and eases every segment from there to its new cell over
 * `durationMs`: progress = (now − the moment the step arrived) / durationMs, clamped, read on each
 * animation frame. A segment that is new this step (the snake grew) starts where the old tail
 * was, so the tail stays put while the body lengthens. Nothing counts in state: progress is
 * derived from a timestamp, so a dropped frame lands where it should rather than late.
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

export function useGlide(snake: readonly number[], size: number, durationMs: number): Point[] {
  const key = snake.join(',')
  const glide = useRef<{ key: string; from: Point[]; drawn: Point[]; startedAt: number } | null>(
    null,
  )
  const [, redraw] = useState(0)
  const instant = durationMs <= 0 || reducedMotion()

  // A new step: glide from where every segment is drawn NOW, starting now. Decided while
  // rendering, so the first frame of the step is already its starting position, never a jump.
  if (!glide.current || glide.current.key !== key) {
    const drawn = glide.current?.drawn ?? snake.map((cell) => centre(cell, size))
    glide.current = { key, from: drawn, drawn, startedAt: performance.now() }
  }
  const current = glide.current
  const progress = instant
    ? 1
    : Math.min(1, Math.max(0, (performance.now() - current.startedAt) / durationMs))

  useEffect(() => {
    if (instant) return
    let frame = 0
    const tick = () => {
      redraw((n) => n + 1)
      if (performance.now() - current.startedAt < durationMs) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [current, durationMs, instant])

  const points = glidePoints(current.from, snake, progress, size)
  current.drawn = points
  return points
}
