import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@xyflow/react'
import type { CanvasSize } from './camera'

/**
 * Place the camera ONCE per content, as soon as the board can be placed — and say, in the same
 * render that brings new content, that it is not placed yet.
 *
 * Three defects this exists to stop. A board that placed its camera in an effect painted one
 * frame of the new content under the OLD camera first, so the owner hides the board while
 * `placing` is true. A board that placed on every data change (a poll, a selection) threw the
 * person's camera away mid-read, so placement is keyed on what the content IS, not on renders.
 * And a board inside a hidden tab has no size, so it waits: placement runs when the pane-zoom is
 * ready and the view is measured, never at zero size.
 *
 * `place` may return a cleanup — a follow-up frame of a two-step move — which runs when the key
 * changes or the board unmounts.
 *
 * Hiding has a ceiling, `REVEAL_MS`: a surface whose size never reaches the store (the agent's
 * off-screen capture of a mini app tab) left the board hidden for good, a black pane with nothing
 * wrong in the console. After the ceiling the board shows at whatever camera it has, and it is
 * still placed the moment it can be.
 */
export const REVEAL_MS = 400

export function useCameraPlacement(
  key: string,
  place: (size: CanvasSize) => void | (() => void),
): boolean {
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const ready = useStore((state) => state.panZoom !== null)
  const [placedKey, setPlacedKey] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const latest = useRef(place)
  const cleanup = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    latest.current = place
  })

  // The cleanup belongs to the KEY, not to the placing effect: that effect re-runs as soon as it
  // records the placement, and returning the cleanup from it cancelled the follow-up frame at once.
  useEffect(
    () => () => {
      cleanup.current?.()
      cleanup.current = null
    },
    [key],
  )

  useEffect(() => {
    const timer = setTimeout(() => setRevealedKey(key), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [key])

  useEffect(() => {
    if (placedKey === key || !ready || width <= 0 || height <= 0) return
    const next = latest.current({ width, height })
    cleanup.current = typeof next === 'function' ? next : null
    setPlacedKey(key)
    // `width`/`height` only gate the FIRST placement of a key: a resize afterwards keeps the
    // camera where the person left it, which is why `placedKey` short-circuits above.
  }, [key, placedKey, ready, width, height])

  return placedKey !== key && revealedKey !== key
}
