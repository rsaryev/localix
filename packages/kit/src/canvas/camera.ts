/**
 * The camera of every board, as pure arithmetic: where a fit lands, which zoom a step reaches, and
 * how a zoom keeps the point under the cursor still.
 *
 * Kept free of React and of the flow library so each rule is decided once and tested as numbers.
 * Before this module the code map and the database diagram each carried their own copy, and the
 * two had drifted: one stepped zoom by the library's factor of 1.2 (83%, 69%, 58% …), the other
 * refit the whole diagram on every selection.
 */
export interface CameraViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasSize {
  width: number
  height: number
}

export interface ZoomLimits {
  min: number
  max: number
}

export const CAMERA_ZOOM: ZoomLimits = { min: 0.1, max: 2.5 }

/**
 * The zooms `+` and `−` land on. A step list rather than a factor: a
 * factor walks through percentages nobody reads (83%, 69%), a list returns to 100% from anywhere
 * in a few presses. Values outside a canvas's limits are simply skipped.
 */
export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 4, 8]

/** The margin a fit leaves on each side, as a share of the view. */
export const FIT_PADDING = 0.14

/**
 * A fit shrinks to show everything but never enlarges past 100%: a
 * board holding one small box would otherwise open with that box blown up to fill the screen.
 */
export const FIT_MAX_ZOOM = 1

/** Durations in milliseconds, one per kind of move, so every board moves at the same pace. */
export const CAMERA_MOTION = { pan: 120, step: 160, fit: 240, focus: 320 } as const

/**
 * A camera move's duration under the person's motion preference: with reduced motion every move
 * lands at once. A glide the eye has to follow — a pan, a zoom step, a fit that swings the whole
 * board — is exactly the vestibular motion the setting exists to stop, and the CSS rule that
 * stills the app's animations never reaches it: the library moves the camera from script.
 */
export function pacedDuration(ms: number | undefined, reducedMotion: boolean): number | undefined {
  return reducedMotion ? 0 : ms
}

/**
 * How long after its last frame the camera counts as RESTING: the board is painted sharp again,
 * cards change their level of detail, a zoom may settle at 100 %. One value, so each thing that
 * waits for the camera to stop agrees on when it has.
 */
export const CAMERA_REST_MS = 180

/** How near 100 % a zoom gesture has to rest to settle AT 100 % (`Canvas`'s `snapZoom`). */
const SNAP_BAND = 0.06

/** 1 when `zoom` rests close enough to 100 % to be settled there, else null (already there too). */
export function snappedZoom(zoom: number): number | null {
  return zoom !== 1 && Math.abs(zoom - 1) <= SNAP_BAND ? 1 : null
}

export function clampZoom(zoom: number, limits: ZoomLimits = CAMERA_ZOOM): number {
  return Math.min(limits.max, Math.max(limits.min, zoom))
}

/**
 * The next zoom step in `direction`, or the limit when no step is left inside it.
 *
 * A step closer than half its gap is skipped: from 98%, `+` landing on 100% is a
 * press that visibly does nothing, so it goes on to 125%. The same rule makes a zoom a hair off a
 * step (a pinch that ended at 0.9999) behave like the step itself.
 */
export function stepZoom(
  zoom: number,
  direction: 1 | -1,
  limits: ZoomLimits = CAMERA_ZOOM,
  steps: readonly number[] = ZOOM_STEPS,
): number {
  const inside = steps.filter((step) => step >= limits.min && step <= limits.max)
  const ordered = direction > 0 ? inside : [...inside].reverse()
  const ahead = (step: number) => (step - zoom) * direction > 0
  const index = ordered.findIndex(ahead)
  if (index < 0) return direction > 0 ? limits.max : limits.min
  const next = ordered[index] as number
  const previous = ordered[index - 1]
  const tooClose = previous !== undefined && Math.abs(next - zoom) <= Math.abs(next - previous) / 2
  return (tooClose ? ordered[index + 1] : next) ?? (direction > 0 ? limits.max : limits.min)
}

/**
 * Zoom to `zoom` while the world point under `anchor` (view coordinates) stays where it is — the
 * rule a wheel zoom, a pinch and a keyboard zoom about the centre all share.
 */
export function zoomAt(
  viewport: CameraViewport,
  anchor: CanvasPoint,
  zoom: number,
  limits: ZoomLimits = CAMERA_ZOOM,
): CameraViewport {
  const next = clampZoom(zoom, limits)
  const scale = next / viewport.zoom
  return {
    zoom: next,
    x: anchor.x - (anchor.x - viewport.x) * scale,
    y: anchor.y - (anchor.y - viewport.y) * scale,
  }
}

/** The viewport that puts world point `center` in the middle of the view at `zoom`. */
export function centerOn(center: CanvasPoint, size: CanvasSize, zoom: number): CameraViewport {
  return { zoom, x: size.width / 2 - center.x * zoom, y: size.height / 2 - center.y * zoom }
}

/** The smallest rectangle holding every rect, or null for none. */
export function boundsOf(rects: Iterable<CanvasRect>): CanvasRect | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  if (minX > maxX) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function midpoint(rect: CanvasRect): CanvasPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export interface FitOptions {
  padding?: number
  /** A fit never enlarges past this; {@link FIT_MAX_ZOOM} by default. */
  maxZoom?: number
  limits?: ZoomLimits
}

/** The zoom at which `bounds` fills the view, inside the padding and the limits. */
export function fitZoom(bounds: CanvasRect, size: CanvasSize, options: FitOptions = {}): number {
  const padding = options.padding ?? FIT_PADDING
  const zoom = Math.min(
    options.maxZoom ?? FIT_MAX_ZOOM,
    (size.width * (1 - padding * 2)) / Math.max(1, bounds.width),
    (size.height * (1 - padding * 2)) / Math.max(1, bounds.height),
  )
  return clampZoom(zoom, options.limits)
}

export function fitViewport(
  bounds: CanvasRect,
  size: CanvasSize,
  options: FitOptions = {},
): CameraViewport {
  return centerOn(midpoint(bounds), size, fitZoom(bounds, size, options))
}

export interface ReadableOptions extends FitOptions {
  /** Below this a fit shows shapes too small to read, so the camera stops fitting. */
  readableZoom?: number
  /** The zoom a content too large to fit opens at. */
  readingZoom?: number
  /** Where a too-large content opens, in world coordinates; the bounds' centre by default. */
  anchor?: CanvasPoint
}

/**
 * Where a content OPENS: fitted while a fit stays readable, otherwise at reading scale on the
 * part worth reading first. A fit of a large level is a field of unreadable dots, and the first
 * thing a person then does is zoom in; opening there saves the step, and fit stays one key away.
 */
export function readableViewport(
  bounds: CanvasRect,
  size: CanvasSize,
  options: ReadableOptions = {},
): CameraViewport {
  const fit = fitZoom(bounds, size, { padding: 0.12, ...options })
  if (fit >= (options.readableZoom ?? 0.62)) return centerOn(midpoint(bounds), size, fit)
  const zoom = clampZoom(options.readingZoom ?? 0.72, options.limits)
  return centerOn(options.anchor ?? midpoint(bounds), size, zoom)
}
