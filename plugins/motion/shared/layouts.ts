import type { MotionScene } from './schema'
import { drawCreativeLayout } from './creative-layouts'
import { drawDarkLayout } from './dark-layouts'
import {
  circle,
  fittedText,
  roundRect,
  reveal,
  drawImageCover,
  type FilmPalette,
  type Painter,
} from './graphics'

export function drawLayout(
  ctx: Painter,
  scene: MotionScene,
  time: number,
  w: number,
  h: number,
  palette: FilmPalette,
  images: ReadonlyMap<string, CanvasImageSource>,
) {
  const u = Math.min(w, h)
  if (drawDarkLayout(ctx, scene, time, w, h, palette)) return
  if (drawCreativeLayout(ctx, scene, time, w, h, palette)) return
  const portrait = h > w * 1.2
  const gutter = u * 0.09
  const { background, foreground, accent, muted } = palette
  const entered = reveal(time)
  const heading = (
    y: number,
    width = w - gutter * 2,
    size = u * 0.13,
    align: CanvasTextAlign = 'left',
  ) => {
    ctx.save()
    ctx.globalAlpha *= reveal(time, 0.08)
    fittedText(
      ctx,
      scene.headline,
      align === 'center' ? w / 2 : gutter,
      y + (1 - reveal(time, 0.08)) * u * 0.07,
      width,
      size,
      foreground,
      { align, maxLines: portrait ? 5 : 3 },
    )
    ctx.restore()
  }
  const body = (y: number, width = w - gutter * 2, align: CanvasTextAlign = 'left') => {
    ctx.save()
    ctx.globalAlpha *= reveal(time, 0.4)
    fittedText(ctx, scene.body, align === 'center' ? w / 2 : gutter, y, width, u * 0.028, muted, {
      weight: 400,
      align,
      maxLines: 5,
      lineHeight: 1.35,
    })
    ctx.restore()
  }
  const label = () => {
    fittedText(ctx, scene.label, gutter, gutter, w - gutter * 2, u * 0.022, muted, {
      weight: 500,
      maxLines: 1,
    })
  }
  if (scene.layout === 'custom') return
  if (scene.layout === 'kinetic') {
    label()
    const text = scene.headline.replace(/\n/gu, ' ')
    const characters = Array.from(text)
    let size = u * 0.22
    const font = () => {
      ctx.font = `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    }
    font()
    while (size > u * 0.025 && ctx.measureText(text).width > w - gutter * 2) {
      size *= 0.92
      font()
    }
    const widths = characters.map((char) => ctx.measureText(char).width)
    const total = widths.reduce((sum, width) => sum + width, 0)
    let x = (w - total) / 2
    characters.forEach((char, i) => {
      const p = reveal(time, i * Math.min(0.055, 0.55 / Math.max(1, characters.length)), 0.55)
      ctx.save()
      ctx.globalAlpha *= p
      ctx.translate(x, h * 0.39 + (1 - p) * size * 0.65)
      ctx.scale(1, 0.55 + p * 0.45)
      ctx.fillStyle = foreground
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(char, 0, 0)
      ctx.restore()
      x += widths[i]!
    })
    roundRect(
      ctx,
      (w - total) / 2,
      h * 0.39 + size * 1.25,
      total * reveal(time, 0.3),
      u * 0.008,
      u * 0.004,
      accent,
    )
    body(h * 0.77, w - gutter * 2, 'center')
  } else if (scene.layout === 'title') {
    ctx.save()
    ctx.globalAlpha *= 0.16
    circle(ctx, w * 0.86, h * 0.38, u * (0.23 + entered * 0.07), accent)
    ctx.strokeStyle = accent
    ctx.lineWidth = u * 0.002
    ctx.beginPath()
    ctx.ellipse(w * 0.84, h * 0.4, u * 0.39, u * 0.24, -0.4 + time * 0.06, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    label()
    heading(h * (portrait ? 0.34 : 0.28), w - gutter * 2, u * (portrait ? 0.16 : 0.15))
    body(h * 0.76)
    roundRect(ctx, gutter, h - gutter, u * 0.13 * entered, u * 0.006, u * 0.003, accent)
  } else if (scene.layout === 'product') {
    label()
    heading(h * (portrait ? 0.18 : 0.28), portrait ? w - gutter * 2 : w * 0.42, u * 0.1)
    body(h * (portrait ? 0.36 : 0.67), portrait ? w - gutter * 2 : w * 0.4)
    const x = portrait ? gutter : w * 0.52
    const y = portrait ? h * 0.5 : h * 0.14
    const pw = portrait ? w - gutter * 2 : w * 0.42
    const ph = portrait ? h * 0.38 : h * 0.72
    ctx.save()
    ctx.translate(x + pw / 2, y + ph / 2 + (1 - entered) * u * 0.12)
    ctx.scale(0.9 + entered * 0.1, 0.9 + entered * 0.1)
    ctx.globalAlpha *= entered
    roundRect(ctx, -pw / 2, -ph / 2, pw, ph, u * 0.025, accent)
    const image = scene.imageId ? images.get(scene.imageId) : null
    if (image) {
      ctx.beginPath()
      ctx.roundRect(-pw / 2, -ph / 2, pw, ph, u * 0.025)
      ctx.clip()
      drawImageCover(ctx, image, -pw / 2, -ph / 2, pw, ph)
    } else {
      const inset = u * 0.035
      roundRect(
        ctx,
        -pw / 2 + inset,
        -ph / 2 + inset,
        pw - inset * 2,
        ph - inset * 2,
        u * 0.012,
        background,
      )
      for (let i = 0; i < 3; i++)
        circle(ctx, -pw / 2 + inset * (1.7 + i * 0.55), -ph / 2 + inset * 1.7, u * 0.005, muted)
      fittedText(
        ctx,
        scene.label || scene.headline.split('\n')[0]!,
        0,
        -ph * 0.22,
        pw * 0.7,
        u * 0.05,
        foreground,
        { align: 'center', maxLines: 2 },
      )
      for (let i = 0; i < 3; i++) {
        const p = reveal(time, 0.5 + i * 0.13)
        roundRect(
          ctx,
          -pw * 0.3,
          ph * (0.03 + i * 0.13),
          pw * 0.6 * p,
          ph * 0.06,
          u * 0.005,
          i === 0 ? accent : muted,
        )
      }
    }
    ctx.restore()
  } else if (scene.layout === 'cards') {
    label()
    heading(h * (portrait ? 0.16 : 0.16), w - gutter * 2, u * 0.09)
    const count = scene.items.length
    scene.items.forEach((item, i) => {
      const p = reveal(time, 0.35 + i * 0.18)
      const cw = portrait
        ? w - gutter * 2
        : (w - gutter * 2 - u * 0.03 * (count - 1)) / Math.max(1, count)
      const ch = portrait ? Math.min(h * 0.12, (h * 0.49) / Math.max(1, count)) : h * 0.31
      const x = portrait ? gutter : gutter + i * (cw + u * 0.03)
      const y = portrait ? h * 0.45 + i * (ch + u * 0.025) : h * 0.5
      ctx.save()
      ctx.globalAlpha *= p
      ctx.translate(x, y + (1 - p) * u * 0.06)
      roundRect(ctx, 0, 0, cw, ch, u * 0.013, accent)
      fittedText(
        ctx,
        `${i + 1}`.padStart(2, '0'),
        u * 0.024,
        u * 0.025,
        cw - u * 0.048,
        u * 0.027,
        background,
      )
      fittedText(
        ctx,
        item,
        u * 0.024,
        portrait ? ch * 0.5 : ch * 0.52,
        cw - u * 0.048,
        u * 0.034,
        background,
        { maxLines: 3 },
      )
      ctx.restore()
    })
    body(h * 0.88)
  } else if (scene.layout === 'stat') {
    label()
    heading(h * 0.19, w - gutter * 2, u * 0.085)
    const number = scene.value * reveal(time, 0.3, 1.6)
    const precision = Number.isInteger(scene.value) ? 0 : 1
    fittedText(
      ctx,
      `${number.toFixed(precision)}${scene.suffix}`,
      gutter,
      h * 0.45,
      w - gutter * 2,
      u * 0.24,
      accent,
      { maxLines: 1 },
    )
    body(h * 0.78)
    roundRect(
      ctx,
      gutter,
      h * 0.71,
      (w - gutter * 2) * reveal(time, 0.6, 1.5),
      u * 0.005,
      u * 0.003,
      accent,
    )
  } else if (scene.layout === 'quote') {
    label()
    roundRect(ctx, gutter, h * 0.27, u * 0.1 * entered, u * 0.007, u * 0.003, accent)
    heading(h * 0.34, w - gutter * 2, u * 0.095)
    body(h * 0.76)
  } else {
    ctx.save()
    ctx.globalAlpha *= entered
    const radius = u * 0.05
    ctx.translate(w / 2, h * 0.3)
    ctx.rotate(((1 - entered) * -Math.PI) / 2)
    roundRect(ctx, -radius, -radius, radius * 2, radius * 2, radius * 0.25, accent)
    circle(ctx, 0, 0, radius * 0.44, background)
    ctx.restore()
    heading(h * 0.46, w - gutter * 2, u * 0.13, 'center')
    body(h * 0.72, w - gutter * 2, 'center')
    fittedText(ctx, scene.label, w / 2, h - gutter, w - gutter * 2, u * 0.022, muted, {
      align: 'center',
      maxLines: 1,
    })
  }
}
