import type { CameraFrame } from './schema'
import type { Painter } from './graphics'
import { projectPoint, surfacePoint, type SurfacePose } from './camera'

export type FilmSurface = HTMLCanvasElement | OffscreenCanvas
export function filmSurface(w: number, h: number): FilmSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}
type Point2 = { x: number; y: number }
const projectionBuffers = new WeakMap<Painter, FilmSurface>()
function triangle(ctx: Painter, image: CanvasImageSource, uv: Point2[], xy: Point2[]) {
  const [a, b, c] = uv as [Point2, Point2, Point2]
  const [p, q, r] = xy as [Point2, Point2, Point2]
  const det = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)
  if (Math.abs(det) < 1e-8) return
  const coefficients = (p: number, q: number, r: number) => [
    (p * (b.y - c.y) + q * (c.y - a.y) + r * (a.y - b.y)) / det,
    (p * (c.x - b.x) + q * (a.x - c.x) + r * (b.x - a.x)) / det,
    (p * (b.x * c.y - c.x * b.y) + q * (c.x * a.y - a.x * c.y) + r * (a.x * b.y - b.x * a.y)) / det,
  ]
  const [xx, xyv, xt] = coefficients(p.x, q.x, r.x)
  const [yx, yy, yt] = coefficients(p.y, q.y, r.y)
  ctx.save()
  ctx.beginPath()
  // Expand every edge by at least one pixel, including long, thin mesh triangles.
  const center = { x: (p.x + q.x + r.x) / 3, y: (p.y + q.y + r.y) / 3 }
  const longest = Math.max(
    Math.hypot(p.x - q.x, p.y - q.y),
    Math.hypot(q.x - r.x, q.y - r.y),
    Math.hypot(r.x - p.x, r.y - p.y),
  )
  const area = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const expansion = Math.min(0.1, (3 * longest) / Math.max(1, area))
  for (const [i, vertex] of [p, q, r].entries()) {
    const dx = vertex.x - center.x,
      dy = vertex.y - center.y
    const x = vertex.x + dx * expansion,
      y = vertex.y + dy * expansion
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.clip()
  ctx.transform(xx!, yx!, xyv!, yy!, xt!, yt!)
  ctx.drawImage(image, 0, 0)
  ctx.restore()
}
export function projectSurface(
  ctx: Painter,
  image: FilmSurface,
  width: number,
  height: number,
  pose: SurfacePose,
  camera: CameraFrame,
  fov: number,
) {
  const { width: w, height: h } = ctx.canvas
  let buffer = projectionBuffers.get(ctx)
  if (!buffer || buffer.width !== w || buffer.height !== h) {
    buffer = filmSurface(w, h)
    projectionBuffers.set(ctx, buffer)
  }
  const projected = buffer.getContext('2d') as Painter
  projected.clearRect(0, 0, w, h)
  projected.imageSmoothingQuality = 'high'
  const columns = 8,
    rows = 5
  const points = Array.from({ length: rows + 1 }, (_, y) =>
    Array.from({ length: columns + 1 }, (_, x) =>
      projectPoint(
        surfacePoint(
          {
            x: (x / columns - 0.5) * width,
            y: (y / rows - 0.5) * height,
            z: 0,
          },
          pose,
        ),
        camera,
        fov,
        w,
        h,
      ),
    ),
  )
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = points[y]![x],
        b = points[y]![x + 1],
        c = points[y + 1]![x + 1],
        d = points[y + 1]![x]
      if (!a || !b || !c || !d) continue
      const left = (x / columns) * image.width,
        right = ((x + 1) / columns) * image.width
      const top = (y / rows) * image.height,
        bottom = ((y + 1) / rows) * image.height
      triangle(
        projected,
        image,
        [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
        ],
        [a, b, c],
      )
      triangle(
        projected,
        image,
        [
          { x: left, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        [a, c, d],
      )
    }
  // Composite opacity and blur once, so overlapping mesh edges cannot brighten during fades.
  ctx.drawImage(buffer, 0, 0)
}
