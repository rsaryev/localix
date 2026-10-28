import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useCanvasCamera, type CameraViewport } from '@localixai/kit/canvas'
import { prefersReducedMotion } from '@localixai/kit/platform'
import type { Box } from '../../shared/ops/geometry'
import { easeInOut, flight } from './flight'
import { frameViewport, type Subject } from './framing'
import { createSpotlights } from './spotlights'

/**
 * Every deliberate move of the board's camera — to an element, to the selection, to where the
 * agent points — goes through here, so each one is remembered, travelled the same way and shown.
 *
 * REMEMBERED: the view it left is pushed on a history, so ⌥← goes back to where you were before
 * the agent (or a click in the layers panel) took you away — the code map's way back up, for a
 * board that has no levels. TRAVELLED: a flight that swings out and back in over a long way
 * (`flight.ts`), landed outright at its end, because the frames that drive it stop for a covered
 * window and the camera would otherwise stay put. SHOWN: what it came to see glows, so the eye finds the thing
 * the agent pointed at instead of a region that merely contains it.
 */
const HISTORY = 30

export interface CameraDirector {
  /** Frame a board rectangle by the board's framing policy. */
  frame(
    rect: Box,
    subject: Subject,
    options?: { zoom?: number; spotlight?: readonly string[] },
  ): Promise<CameraViewport | null>
  /** Go to a viewport, remembering the one left. */
  jump(viewport: CameraViewport, spotlight?: readonly string[]): Promise<CameraViewport>
  /** Go to a viewport WITHOUT remembering: the camera keeping up, not a trip worth going back from. */
  glide(viewport: CameraViewport): Promise<CameraViewport>
  back(): boolean
  forward(): boolean
  /** Light elements up where they are, without moving the camera. */
  spotlight(ids: readonly string[]): void
  /** The view's size in screen pixels, or null while it has none. */
  size(): { width: number; height: number } | null
  /** For the "back" affordance: whether there is somewhere to go back to, and since when. */
  history: { canBack: boolean; canForward: boolean; jumpedAt: number }
}

export function useCameraDirector(root: RefObject<HTMLElement | null>): CameraDirector {
  const camera = useCanvasCamera()
  const past = useRef<CameraViewport[]>([])
  const future = useRef<CameraViewport[]>([])
  const [history, setHistory] = useState({ canBack: false, canForward: false, jumpedAt: 0 })

  const publish = useCallback(
    (jumped: boolean) =>
      setHistory((current) => ({
        canBack: past.current.length > 0,
        canForward: future.current.length > 0,
        jumpedAt: jumped ? Date.now() : current.jumpedAt,
      })),
    [],
  )

  // The view's size is the camera's own answer (the library's store), not a measure of the DOM.
  const size = useCallback(() => camera.size(), [camera])

  // The glow's timers belong to this board; unmounting clears them (see the effect below).
  const [lights] = useState(() => createSpotlights(root))
  const spotlight = lights.light

  // One flight at a time: a new jump takes over from wherever the last one had got to, and the
  // person's own hand — a wheel, a pinch, a press on the board — ends a flight where it is.
  const flying = useRef(0)
  const stopFlight = useRef<(() => void) | null>(null)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const takeOver = () => {
      flying.current++
      stopFlight.current?.()
    }
    element.addEventListener('wheel', takeOver, { passive: true })
    element.addEventListener('gesturestart', takeOver)
    element.addEventListener('pointerdown', takeOver)
    return () => {
      // A closed board used to keep its frame chain and landing timer alive. End both and
      // settle the awaiting camera request before the detached tree can be retained.
      takeOver()
      lights.clear()
      element.removeEventListener('wheel', takeOver)
      element.removeEventListener('gesturestart', takeOver)
      element.removeEventListener('pointerdown', takeOver)
    }
  }, [root, lights])
  const travel = useCallback(
    async (viewport: CameraViewport) => {
      stopFlight.current?.()
      const view = size()
      // Reduced motion lands the camera at once: a flight's swing out and back in is the kind of
      // motion the setting asks to stop. The trip is still remembered and its target still glows,
      // so the person loses the travel, not the way back or the thing they were shown.
      if (!view || prefersReducedMotion()) {
        flying.current++
        camera.set(viewport)
        return camera.get()
      }
      const ticket = ++flying.current
      const trip = flight(camera.get(), viewport, view)
      const started = performance.now()
      await new Promise<void>((resolve) => {
        // Frames drive the swing; the timer lands it even when frames stop (a covered window).
        let frame: number | null = null
        const finish = () => {
          window.clearTimeout(landing)
          if (frame !== null) cancelAnimationFrame(frame)
          if (stopFlight.current === finish) stopFlight.current = null
          resolve()
        }
        const landing = window.setTimeout(finish, trip.durationMs + 80)
        stopFlight.current = finish
        const step = (now: number) => {
          frame = null
          if (ticket !== flying.current) return finish()
          const t = Math.min(1, (now - started) / trip.durationMs)
          camera.set(trip.at(easeInOut(t)))
          if (t < 1) frame = requestAnimationFrame(step)
          else finish()
        }
        frame = requestAnimationFrame(step)
      })
      if (ticket === flying.current) camera.set(viewport)
      return camera.get()
    },
    [camera, size],
  )

  const jump = useCallback(
    async (viewport: CameraViewport, lit: readonly string[] = []) => {
      past.current = [...past.current, camera.get()].slice(-HISTORY)
      future.current = []
      publish(true)
      const landed = await travel(viewport)
      spotlight(lit)
      return landed
    },
    [camera, publish, spotlight, travel],
  )

  const frame = useCallback<CameraDirector['frame']>(
    async (rect, subject, options = {}) => {
      const view = size()
      if (!view) return null
      return jump(frameViewport(rect, view, subject, options.zoom), options.spotlight)
    },
    [jump, size],
  )

  const step = useCallback(
    (from: { current: CameraViewport[] }, to: { current: CameraViewport[] }) => {
      const target = from.current.at(-1)
      if (!target) return false
      from.current = from.current.slice(0, -1)
      to.current = [...to.current, camera.get()].slice(-HISTORY)
      publish(false)
      void travel(target)
      return true
    },
    [camera, publish, travel],
  )
  const back = useCallback(() => step(past, future), [step])
  const forward = useCallback(() => step(future, past), [step])

  return useMemo(
    () => ({ frame, jump, glide: travel, back, forward, spotlight, size, history }),
    [frame, jump, travel, back, forward, spotlight, size, history],
  )
}
