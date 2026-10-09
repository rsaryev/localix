import { rosette, orbitalMark } from './motifs'
import type { MotionScene } from './schema'
import { circle, fittedText, reveal, roundRect, type FilmPalette, type Painter } from './graphics'

// Original geometric compositions. Every motion samples scene time, including slow movement.
export function drawCreativeLayout(
  ctx: Painter,
  scene: MotionScene,
  time: number,
  w: number,
  h: number,
  p: FilmPalette,
): boolean {
  if (!['poster', 'ribbon', 'orbit', 'editorial', 'steps', 'bars'].includes(scene.layout))
    return false
  const u = Math.min(w, h)
  const g = u * 0.075
  const portrait = h > w * 1.2
  const enter = reveal(time, 0.08, 1.1)
  const text = (
    value: string,
    x: number,
    y: number,
    width: number,
    size: number,
    color = p.foreground,
    options: NonNullable<Parameters<typeof fittedText>[7]> = {},
  ) => fittedText(ctx, value, x, y, width, size, color, options)
  const footer = () => {
    ctx.save()
    ctx.globalAlpha *= reveal(time, 0.35)
    text(scene.label, g, g, w - g * 2, u * 0.024, p.foreground, { weight: 500, maxLines: 1 })
    text(scene.body, g, h - g - u * 0.065, w - g * 2, u * 0.026, p.foreground, {
      weight: 400,
      maxLines: 2,
    })
    ctx.restore()
  }
  if (scene.layout === 'poster') {
    ctx.save()
    ctx.translate(w * 0.76, h * (portrait ? 0.59 : 0.49))
    ctx.rotate(-0.3 + time * 0.09)
    const radius = u * (0.25 + 0.09 * enter)
    rosette(ctx, radius, p.accent)
    circle(ctx, 0, 0, u * 0.09, p.background)
    ctx.restore()
    const lines = scene.headline.split('\n')
    lines.forEach((line, i) => {
      const progress = reveal(time, i * 0.1, 0.65)
      ctx.save()
      ctx.beginPath()
      ctx.rect(g, h * 0.18 + i * u * 0.22, w - g * 2, u * 0.23)
      ctx.clip()
      text(
        line,
        g,
        h * 0.18 + i * u * 0.22 + (1 - progress) * u * 0.24,
        w - g * 2,
        u * 0.22,
        p.foreground,
        { weight: 800, maxLines: 1 },
      )
      ctx.restore()
    })
    footer()
  } else if (scene.layout === 'ribbon') {
    const lines = scene.headline.split('\n')
    const row = u * 0.17
    lines.forEach((line, i) => {
      const progress = reveal(time, i * 0.09, 0.65)
      ctx.save()
      ctx.translate(w / 2 + (i % 2 ? 1 : -1) * (1 - progress) * w * 0.3, h * 0.3 + i * row)
      ctx.rotate((i % 2 ? 1 : -1) * (0.04 + (1 - progress) * 0.08))
      roundRect(ctx, -w * 0.7, -u * 0.013, w * 1.4, row * 0.94, 0, i % 2 ? p.accent : p.foreground)
      text(line, 0, 0, w * 0.84, row * 0.8, p.background, {
        align: 'center',
        weight: 800,
        maxLines: 1,
      })
      ctx.restore()
    })
    footer()
  } else if (scene.layout === 'orbit') {
    const centerX = portrait ? w * 0.5 : w * 0.73
    const centerY = portrait ? h * 0.61 : h * 0.48
    const radius = u * (portrait ? 0.24 : 0.29)
    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate((1 - enter) * -1.3 + time * 0.08)
    orbitalMark(ctx, radius, enter, p.accent)
    circle(ctx, 0, 0, u * 0.032 * enter, p.foreground)
    ctx.restore()
    text(
      scene.headline,
      g + (1 - enter) * -g,
      h * (portrait ? 0.17 : 0.26),
      portrait ? w - g * 2 : w * 0.47,
      u * 0.145,
      p.foreground,
      { weight: 700, maxLines: 3 },
    )
    footer()
  } else if (scene.layout === 'editorial') {
    const size = u * 0.18
    ctx.save()
    ctx.translate(w * (portrait ? 0.72 : 0.81), h * 0.56)
    ctx.rotate(-0.17 + (1 - enter) * 0.3)
    roundRect(ctx, -u * 0.17, -u * 0.26, u * 0.34, u * 0.52, 0, p.accent)
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = p.background
      ctx.lineWidth = u * 0.004
      ctx.beginPath()
      ctx.ellipse(0, 0, u * (0.04 + i * 0.025), u * (0.08 + i * 0.028), time * 0.04, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    text(scene.headline, g, h * 0.2 + (1 - enter) * u * 0.045, w - g * 2, size, p.foreground, {
      family: 'Georgia, "Times New Roman", serif',
      weight: 400,
      maxLines: 3,
      lineHeight: 0.98,
    })
    footer()
  } else if (scene.layout === 'steps') {
    text(scene.headline, g, h * 0.16, w - g * 2, u * 0.13, p.foreground, { maxLines: 2 })
    const items = scene.items.slice(0, 6)
    const count = Math.max(1, items.length)
    items.forEach((item, i) => {
      const progress = reveal(time, 0.3 + i * 0.075, 0.9)
      const x = portrait ? g : g + (i * (w - g * 2)) / count
      const y = portrait ? h * 0.42 + (i * h * 0.36) / count : h * 0.52
      const r = u * (portrait ? 0.025 : 0.045)
      const gap = portrait ? (h * 0.36) / count : (w - g * 2) / count
      if (i < count - 1) {
        ctx.strokeStyle = p.accent
        ctx.lineWidth = u * 0.004
        ctx.beginPath()
        ctx.moveTo(x + r, y + r)
        ctx.lineTo(x + r + (portrait ? 0 : gap * progress), y + r + (portrait ? gap * progress : 0))
        ctx.stroke()
      }
      circle(ctx, x + r, y + r, r * progress, p.accent)
      text(String(i + 1), x + r, y + r * 0.45, r * 1.5, r, p.background, {
        align: 'center',
        maxLines: 1,
      })
      text(
        item,
        portrait ? x + r * 3 : x,
        portrait ? y : y + r * 2.6,
        portrait ? w - g * 2 - r * 3 : gap * 0.85,
        u * 0.032,
        p.foreground,
        { maxLines: 3 },
      )
    })
    footer()
  } else {
    text(scene.headline, g, h * 0.14, w - g * 2, u * 0.105, p.foreground, { maxLines: 2 })
    const progress = reveal(time, 0.25, 1.5)
    text(
      `${(scene.value * progress).toFixed(Number.isInteger(scene.value) ? 0 : 1)}${scene.suffix}`,
      g,
      h * 0.36,
      w * (portrait ? 0.83 : 0.43),
      u * 0.2,
      p.foreground,
      { maxLines: 1, weight: 700 },
    )
    const bx = portrait ? g : w * 0.53
    const by = portrait ? h * 0.56 : h * 0.39
    const bw = portrait ? w - g * 2 : w * 0.39
    const bh = h * (portrait ? 0.23 : 0.38)
    const max = Math.max(1, ...scene.series.map((item) => item.value))
    const count = Math.max(1, scene.series.length)
    scene.series.forEach((item, i) => {
      const height = item.value / max
      const grow = reveal(time, 0.25 + i * 0.08, 1.1)
      const x = bx + (i * bw) / count
      roundRect(
        ctx,
        x,
        by + bh * (1 - height * grow),
        (bw / count) * 0.7,
        bh * height * grow,
        u * 0.009,
        i === count - 1 ? p.foreground : p.accent,
      )
      text(item.label, x, by + bh + u * 0.012, (bw / count) * 0.9, u * 0.021, p.foreground, {
        maxLines: 1,
      })
    })
    footer()
  }
  return true
}
