import type { CameraViewport } from '@localixai/kit/canvas'

/**
 * The camera's flight between two views — the swing: out a little, across, back in.
 *
 * A straight glide between two far views keeps the zoom it started with, so the board streams
 * past too fast to follow and the eye loses where it is going. The optimal path of van Wijk and
 * Nuij ("Smooth and efficient zooming and panning", 2003) instead rises as the distance grows —
 * you see the destination come into view before descending on it — and for a near target it is
 * all but a straight glide. The formula is d3's `interpolateZoom` (the one d3-zoom animates
 * with), restated over a board viewport instead of pulling d3 into the mini app for thirty lines.
 *
 * A view is its centre and its width in BOARD units; `rho` is how high the swing rises (√2, d3's
 * default and the paper's recommendation).
 */
const RHO = Math.SQRT2
const RHO2 = 2
const RHO4 = 4
const EPSILON2 = 1e-12
/** A flight is never a flicker nor a wait: the paper's duration, held between these. */
const MIN_MS = 320
const MAX_MS = 1_100

interface Size {
  width: number
  height: number
}

type View = [cx: number, cy: number, w: number]

const toView = (viewport: CameraViewport, size: Size): View => [
  (size.width / 2 - viewport.x) / viewport.zoom,
  (size.height / 2 - viewport.y) / viewport.zoom,
  size.width / viewport.zoom,
]

const toViewport = ([cx, cy, w]: View, size: Size): CameraViewport => {
  const zoom = size.width / w
  return { x: size.width / 2 - cx * zoom, y: size.height / 2 - cy * zoom, zoom }
}

export interface Flight {
  /** The viewport at `t` in 0…1 (0 is where it starts, 1 exactly where it lands). */
  at(t: number): CameraViewport
  durationMs: number
}

export function flight(from: CameraViewport, to: CameraViewport, size: Size): Flight {
  const [ux0, uy0, w0] = toView(from, size)
  const [ux1, uy1, w1] = toView(to, size)
  const dx = ux1 - ux0
  const dy = uy1 - uy0
  const d2 = dx * dx + dy * dy
  let path: (t: number) => View
  let S: number
  if (d2 < EPSILON2) {
    S = Math.log(w1 / w0) / RHO
    path = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)]
  } else {
    const d1 = Math.sqrt(d2)
    const b0 = (w1 * w1 - w0 * w0 + RHO4 * d2) / (2 * w0 * RHO2 * d1)
    const b1 = (w1 * w1 - w0 * w0 - RHO4 * d2) / (2 * w1 * RHO2 * d1)
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
    S = (r1 - r0) / RHO
    const coshR0 = Math.cosh(r0)
    path = (t) => {
      const s = t * S
      const u = (w0 / (RHO2 * d1)) * (coshR0 * Math.tanh(RHO * s + r0) - Math.sinh(r0))
      return [ux0 + u * dx, uy0 + u * dy, (w0 * coshR0) / Math.cosh(RHO * s + r0)]
    }
  }
  const durationMs = Math.min(MAX_MS, Math.max(MIN_MS, (Math.abs(S) * 1000 * RHO) / Math.SQRT2))
  return {
    at: (t) => (t >= 1 ? to : t <= 0 ? from : toViewport(path(t), size)),
    durationMs,
  }
}

/** Slow out of the start and into the landing, as a swing does. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
