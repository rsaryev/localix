import type { Painter } from './graphics'

// These measure the film's stage. Their transforms are sampled by the renderer, never a clock.
export function stageGrid(ctx: Painter, w: number, h: number, color: string, drift = 0) {
  const step = Math.min(w, h) / 6
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(0.5, Math.min(w, h) * 0.001)
  ctx.globalAlpha *= 0.12
  ctx.beginPath()
  for (let x = (drift % step) - step; x < w + step; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = -step; y < h + step; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
  ctx.restore()
}

export function apertureFrame(ctx: Painter, w: number, h: number, color: string, progress = 1) {
  const corner = Math.min(w, h) * 0.08
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(0.8, Math.min(w, h) * 0.003)
  ctx.beginPath()
  for (const [x, y, sx, sy] of [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [0, h, 1, -1],
    [w, h, -1, -1],
  ]) {
    ctx.moveTo(x!, y! + sy! * corner * progress)
    ctx.lineTo(x!, y!)
    ctx.lineTo(x! + sx! * corner * progress, y!)
  }
  ctx.stroke()
  ctx.restore()
}
