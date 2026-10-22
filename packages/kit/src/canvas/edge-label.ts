/**
 * Where a written edge label sits, and where a dragged one lands.
 *
 * A caption is a person's words about a line, so it must never hide the line: it sits BESIDE the
 * stroke — above a run that is more across than down, to the right of one that is more down than
 * across — with a visible gap, the rule a diagram reads cleanly by. And it can slide along the
 * line, as on every whiteboard, so a label crowded by a node moves instead of shrinking.
 *
 * Only what can be measured is a function of a path here; the SVG measuring is the caller's, so
 * this stays pure and testable without a renderer.
 */
export interface PathProbe {
  length: number
  pointAt: (distance: number) => { x: number; y: number }
}

export interface LabelAnchor {
  x: number
  y: number
  /** The run at the anchor is more horizontal than vertical: the label goes above it. */
  across: boolean
}

/** The point `t` (0…1) of the way along the path, and which way the line runs there. */
export function labelAnchor(probe: PathProbe, t: number): LabelAnchor {
  const at = Math.min(1, Math.max(0, t)) * probe.length
  const point = probe.pointAt(at)
  // The direction from a little before to a little after: an elbow's corner reads as the run
  // the anchor sits on, never as a diagonal between two runs.
  const reach = Math.min(4, probe.length / 2)
  const before = probe.pointAt(Math.max(0, at - reach))
  const after = probe.pointAt(Math.min(probe.length, at + reach))
  return {
    x: point.x,
    y: point.y,
    across: Math.abs(after.x - before.x) >= Math.abs(after.y - before.y),
  }
}

/** The fraction of the path nearest to `target`: where a dragged label is let go. */
export function nearestT(probe: PathProbe, target: { x: number; y: number }, samples = 64) {
  let best = 0.5
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index <= samples; index++) {
    const t = index / samples
    const point = probe.pointAt(t * probe.length)
    const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = t
    }
  }
  // Clear of the ends, where the label would sit on a node's edge or an arrowhead.
  return Math.min(0.92, Math.max(0.08, Math.round(best * 100) / 100))
}

/** The gap, in board pixels, between a caption's edge and the stroke it names. */
export const LABEL_GAP = 6
