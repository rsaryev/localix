import { circle, roundRect, type Painter } from './graphics'

/** Exact geometric motifs shared by layouts and independently keyframed shape layers. */
export function rosette(ctx: Painter, radius: number, color: string, arms = 12) {
  for (let i = 0; i < arms; i++) {
    ctx.save()
    ctx.rotate((i * Math.PI * 2) / arms)
    roundRect(ctx, radius * 0.16, -radius * 0.1, radius * 0.84, radius * 0.2, radius * 0.1, color)
    ctx.restore()
  }
  circle(ctx, 0, 0, radius * 0.25, color)
}

export function orbitalMark(ctx: Painter, radius: number, progress: number, color: string) {
  for (let i = 0; i < 5; i++) {
    ctx.save()
    ctx.rotate((i * Math.PI) / 5)
    ctx.strokeStyle = color
    ctx.lineWidth = radius * (0.045 + i * 0.006)
    ctx.beginPath()
    ctx.ellipse(0, 0, radius, radius * (0.16 + i * 0.035) * progress, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}

export function ring(ctx: Painter, radius: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = radius * 0.13
  ctx.beginPath()
  ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2)
  ctx.stroke()
}
