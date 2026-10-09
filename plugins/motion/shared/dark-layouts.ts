import type { MotionScene } from './schema'
import { fittedText, reveal, type FilmPalette, type Painter } from './graphics'
import { apertureFrame, stageGrid } from './dark-primitives'

// Mask -> readable hold -> lockup. Every frame is seekable, including the moving stage.
export function drawDarkLayout(
  ctx: Painter,
  scene: MotionScene,
  time: number,
  w: number,
  h: number,
  p: FilmPalette,
) {
  if (!['hook', 'focus', 'wordmark'].includes(scene.layout)) return false
  const u = Math.min(w, h)
  const g = u * 0.09
  const portrait = h > w * 1.2
  const lines = scene.headline.split('\n').slice(0, 3)
  const text = (
    value: string,
    x: number,
    y: number,
    width: number,
    size: number,
    options: NonNullable<Parameters<typeof fittedText>[7]> = {},
  ) => fittedText(ctx, value, x, y, width, size, p.foreground, options)
  const support = () => {
    ctx.save()
    ctx.globalAlpha *= reveal(time, 0.8, 0.5)
    fittedText(ctx, scene.body, g, h - g - u * 0.045, w - 2 * g, u * 0.024, p.muted, {
      weight: 400,
      maxLines: 2,
    })
    ctx.restore()
  }
  if (scene.layout === 'hook') {
    // A quiet coordinate field gives the zoom a stable point of reference.
    stageGrid(ctx, w, h, p.muted, time * u * 0.012)
    const size = u * (portrait ? 0.22 : 0.245)
    const lineHeight = size * 1.06
    const top = h * 0.48 - (lines.length * lineHeight) / 2
    lines.forEach((line, i) => {
      const enter = reveal(time, i * 0.14, 0.75)
      ctx.save()
      ctx.beginPath()
      ctx.rect(g, top + i * lineHeight, w - 2 * g, lineHeight)
      ctx.clip()
      const scale = 1.1 - enter * 0.1
      ctx.translate(g, top + i * lineHeight + (1 - enter) * lineHeight)
      ctx.scale(scale, scale)
      text(line, 0, 0, (w - 2 * g) / scale, size, { weight: 600, maxLines: 1 })
      ctx.restore()
    })
    const scan = reveal(time, 0.12, 1.1)
    ctx.save()
    ctx.globalAlpha *= 0.7 * (1 - reveal(time, 1.05, 0.3))
    ctx.fillStyle = p.foreground
    ctx.fillRect(g + (w - 2 * g) * scan, h * 0.18, u * 0.002, h * 0.62)
    ctx.restore()
    support()
  } else if (scene.layout === 'focus') {
    const enter = reveal(time, 0.1, 1.1)
    const fw = portrait ? w * 0.7 : w * 0.4
    const fh = portrait ? h * 0.3 : h * 0.65
    const x = portrait ? w / 2 : w * 0.72
    const y = portrait ? h * 0.62 : h * 0.48
    ctx.save()
    ctx.translate(x, y + (1 - enter) * u * 0.07)
    ctx.rotate((1 - enter) * -0.06)
    ctx.scale(0.85 + enter * 0.15, 0.85 + enter * 0.15)
    ctx.globalAlpha *= enter
    ctx.translate(-fw / 2, -fh / 2)
    ctx.beginPath()
    ctx.rect(0, 0, fw, fh)
    ctx.clip()
    const light = ctx.createRadialGradient(fw * 0.55, fh * 0.45, 0, fw / 2, fh / 2, fw * 0.7)
    light.addColorStop(0, p.accent)
    light.addColorStop(1, p.background)
    ctx.save()
    ctx.globalAlpha *= 0.16
    ctx.fillStyle = light
    ctx.fillRect(0, 0, fw, fh)
    ctx.restore()
    if (scene.items.length) {
      // A restrained product flow: editable words, one rail, a traveling point of attention.
      const items = scene.items
      const left = fw * 0.13
      const right = fw * 0.87
      const rail = fh * 0.55
      ctx.strokeStyle = p.muted
      ctx.lineWidth = u * 0.001
      ctx.beginPath()
      ctx.moveTo(left, rail)
      ctx.lineTo(left + (right - left) * reveal(time, 0.4, 1.3), rail)
      ctx.stroke()
      items.forEach((item, i) => {
        const position = left + ((right - left) * i) / Math.max(1, items.length - 1)
        const arrive = reveal(time, 0.5 + i * 0.28)
        ctx.save()
        ctx.globalAlpha *= arrive
        fittedText(
          ctx,
          item,
          position,
          fh * 0.34,
          (fw * 0.7) / items.length,
          u * 0.025,
          p.foreground,
          {
            align: 'center',
            maxLines: 2,
            weight: 500,
          },
        )
        ctx.fillStyle = p.accent
        ctx.beginPath()
        ctx.arc(position, rail, u * 0.009, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })
      fittedText(ctx, scene.label, fw * 0.1, fh * 0.12, fw * 0.8, u * 0.02, p.muted, {
        maxLines: 1,
        weight: 500,
      })
    } else {
      // One expanding aperture, with a glint that travels its edge, then settles.
      for (let i = 0; i < 4; i++) {
        const size = u * (0.1 + i * 0.045) * reveal(time, i * 0.1, 1.2)
        ctx.save()
        ctx.translate(fw / 2, fh / 2)
        ctx.rotate(Math.PI / 4 + i * 0.12 + time * 0.025)
        ctx.translate(-size, -size)
        ctx.globalAlpha *= 1 - i * 0.18
        apertureFrame(ctx, size * 2, size * 2, p.accent)
        ctx.restore()
      }
    }
    ctx.restore()
    ctx.save()
    ctx.translate(x - fw / 2, y - fh / 2)
    ctx.globalAlpha *= enter * 0.65
    apertureFrame(ctx, fw, fh, p.accent, enter)
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    const width = portrait ? w - 2 * g : w * 0.44
    const top = portrait ? h * 0.17 : h * 0.33
    ctx.rect(g, top, width, u * 0.4)
    ctx.clip()
    text(scene.headline, g, top + (1 - reveal(time, 0.25)) * u * 0.35, width, u * 0.13, {
      maxLines: 3,
    })
    ctx.restore()
    support()
  } else {
    const enter = reveal(time, 0.12, 1.1)
    const size = u * (portrait ? 0.19 : 0.2)
    const block = lines.length * size * 1.08
    ctx.save()
    ctx.translate(w / 2, h * 0.45)
    const radius = u * (0.23 + enter * 0.1)
    ctx.strokeStyle = p.accent
    ctx.lineWidth = u * 0.0013
    ctx.globalAlpha *= 0.4
    ctx.beginPath()
    ctx.ellipse(0, 0, radius * 1.6, radius, -0.25 + time * 0.015, 0, Math.PI * 2 * enter)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.rect(g, h * 0.45 - block / 2, (w - 2 * g) * enter, block + u * 0.025)
    ctx.clip()
    text(scene.headline, w / 2, h * 0.45 - block / 2, w - 2 * g, size, {
      align: 'center',
      maxLines: 3,
      weight: 500,
      lineHeight: 1.08,
    })
    ctx.restore()
    const length = u * 0.12 * reveal(time, 0.5, 0.9)
    ctx.fillStyle = p.accent
    ctx.fillRect(w / 2 - length / 2, h * 0.77, length, u * 0.002)
    if (scene.label)
      fittedText(ctx, scene.label, w / 2, h * 0.82, w - 2 * g, u * 0.019, p.muted, {
        align: 'center',
        weight: 400,
        maxLines: 1,
      })
    support()
  }
  return true
}
