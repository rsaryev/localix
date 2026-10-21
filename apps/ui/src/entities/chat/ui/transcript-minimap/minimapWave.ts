/**
 * The rail's magnification curve.
 *
 * Hovering must lift a WAVE, not a single bar: the ticks around the pointer swell with the
 * amplitude falling off by distance, the way a dock magnifies its neighbours. A lone growing
 * tick gives the pointer nothing to follow between ticks — the movement is what makes the
 * control feel continuous.
 */

/** How many ticks on each side of the pointer the wave reaches. */
export const WAVE_RADIUS = 4

/**
 * How many ticks the rail shows at once — it is a WINDOW onto the conversation, not a map of all
 * of it. A transcript can hold a million messages; one tick each would be an unreadable stripe
 * (and a million DOM nodes). A fixed-size window keeps the rail the same physical size in every
 * session and slides through the conversation as you scroll, the way a scrollbar thumb does.
 */
export const WINDOW_SIZE = 26

/**
 * Where the window starts, so it stays centred on `current` and never runs off either end of the
 * conversation — at the top and bottom the window stops sliding and the marker travels inside it
 * instead, which is what keeps the first and last messages reachable.
 */
export function windowStart(current: number, total: number, size = WINDOW_SIZE): number {
  if (total <= size) return 0
  return Math.min(Math.max(current - Math.floor(size / 2), 0), total - size)
}

/** Resting and peak tick lengths, in px. The gap between them IS the amplitude. */
export const TICK_WIDTH_REST = 10
export const TICK_WIDTH_PEAK = 30

/**
 * Raised-cosine falloff: 1 at the pointer, 0 at `WAVE_RADIUS`, with zero slope at both ends —
 * a linear falloff would put a visible crease at the crest and at the wave's edge.
 */
export function waveFalloff(distance: number, radius = WAVE_RADIUS): number {
  const d = Math.abs(distance)
  if (d >= radius) return 0
  return (1 + Math.cos((Math.PI * d) / radius)) / 2
}

/** A tick's length given its distance from the hovered tick (`null` = nothing hovered). */
export function tickWidth(index: number, hovered: number | null): number {
  if (hovered === null) return TICK_WIDTH_REST
  const lift = waveFalloff(index - hovered)
  return TICK_WIDTH_REST + (TICK_WIDTH_PEAK - TICK_WIDTH_REST) * lift
}

/** Ink for a tick: the crest reads as foreground, the tails stay quiet chrome. */
export function tickOpacity(index: number, hovered: number | null, current: boolean): number {
  const lift = hovered === null ? 0 : waveFalloff(index - hovered)
  const base = current ? 0.55 : 0.24
  return base + (0.85 - base) * lift
}
