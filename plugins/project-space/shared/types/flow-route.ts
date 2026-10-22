/**
 * A connector's line at right angles: through the points the layout chose, square to the side it
 * leaves by and the side it enters, with each corner rounded. Pure geometry, so the server sizes
 * a flowchart and the view draws it from the same answer.
 */
export interface Point {
  x: number
  y: number
}
export type Side = 'top' | 'right' | 'bottom' | 'left'
type Axis = 'v' | 'h'

const axisOf = (side: Side): Axis => (side === 'top' || side === 'bottom' ? 'v' : 'h')
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5

/** One leg from `a` to `b`, starting along `start` and arriving along `end`. */
function leg(a: Point, b: Point, start: Axis, end: Axis): Point[] {
  if (start === 'v' && end === 'v') {
    if (Math.abs(a.x - b.x) < 0.5) return [b]
    const mid = (a.y + b.y) / 2
    return [{ x: a.x, y: mid }, { x: b.x, y: mid }, b]
  }
  if (start === 'h' && end === 'h') {
    if (Math.abs(a.y - b.y) < 0.5) return [b]
    const mid = (a.x + b.x) / 2
    return [{ x: mid, y: a.y }, { x: mid, y: b.y }, b]
  }
  return start === 'h' ? [{ x: b.x, y: a.y }, b] : [{ x: a.x, y: b.y }, b]
}

/**
 * The orthogonal route through `points`: the first leg starts square to the side it leaves by,
 * the last arrives square to the side it enters, and the legs between run along the flow (down a
 * top-to-bottom chart, across a left-to-right one).
 */
export function orthogonalRoute(points: readonly Point[], sides: [Side, Side], down: boolean) {
  const along: Axis = down ? 'v' : 'h'
  const route: Point[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const start = i === 1 ? axisOf(sides[0]) : along
    const end = i === points.length - 1 ? axisOf(sides[1]) : along
    route.push(...leg(route.at(-1)!, points[i]!, start, end))
  }
  // Drop repeated points and the middle of any straight run, so each corner is a real turn.
  const clean: Point[] = []
  for (const point of route) {
    if (clean.length && same(clean.at(-1)!, point)) continue
    const [a, b] = [clean.at(-2), clean.at(-1)]
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)))
      clean.pop()
    clean.push(point)
  }
  return clean
}

const unit = (from: Point, to: Point): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}
const r1 = (value: number) => Math.round(value * 10) / 10

/**
 * The route as an SVG path with each corner rounded (8px, less where a run is short), its ends
 * pulled back from where an arrowhead sits so the line never shows through the head.
 */
export function roundedPath(
  route: readonly Point[],
  head: 'arrow' | 'none' | 'both',
  arrow: number,
): { path: string; heads: { tip: Point; toward: Point }[] } {
  const points = route.map((point) => ({ ...point }))
  const heads: { tip: Point; toward: Point }[] = []
  const pull = (at: number, from: number) => {
    const toward = unit(points[from]!, points[at]!)
    heads.push({ tip: { ...points[at]! }, toward })
    points[at] = { x: points[at]!.x - toward.x * arrow, y: points[at]!.y - toward.y * arrow }
  }
  if (points.length >= 2 && head !== 'none') pull(points.length - 1, points.length - 2)
  if (points.length >= 2 && head === 'both') pull(0, 1)
  let path = `M ${r1(points[0]!.x)} ${r1(points[0]!.y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const [before, corner, after] = [points[i - 1]!, points[i]!, points[i + 1]!]
    const r = Math.min(
      8,
      Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
      Math.hypot(after.x - corner.x, after.y - corner.y) / 2,
    )
    const into = unit(before, corner)
    const out = unit(corner, after)
    path += ` L ${r1(corner.x - into.x * r)} ${r1(corner.y - into.y * r)}`
    path += ` Q ${r1(corner.x)} ${r1(corner.y)} ${r1(corner.x + out.x * r)} ${r1(corner.y + out.y * r)}`
  }
  const last = points.at(-1)!
  return { path: `${path} L ${r1(last.x)} ${r1(last.y)}`, heads }
}
