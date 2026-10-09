import type { MotionScene } from './schema'
import { fittedText, roundRect, drawImageCover, type Painter, type FilmPalette } from './graphics'
import { filmSurface, type FilmSurface } from './perspective'

export function tint(a: string, b: string, amount: number) {
  const channels = [1, 3, 5].map((i) =>
    Math.round(
      Number.parseInt(a.slice(i, i + 2), 16) * (1 - amount) +
        Number.parseInt(b.slice(i, i + 2), 16) * amount,
    ),
  )
  return `rgb(${channels.join(',')})`
}
const cache = new WeakMap<MotionScene, Map<string, FilmSurface>>()
export function texture(
  scene: MotionScene,
  key: string,
  width: number,
  height: number,
  paint: (ctx: Painter, w: number, h: number) => void,
) {
  let entries = cache.get(scene)
  if (!entries) {
    entries = new Map()
    cache.set(scene, entries)
  }
  const old = entries.get(key)
  if (old) return old
  const image = filmSurface(width, height)
  const ctx = image.getContext('2d') as Painter | null
  if (!ctx) throw new Error('Film textures need a 2D canvas.')
  paint(ctx, width, height)
  if (entries.size >= 8) entries.delete(entries.keys().next().value!)
  entries.set(key, image)
  return image
}
export function wordSurface(scene: MotionScene, value: string, p: FilmPalette, quiet = false) {
  return texture(scene, `word:${p.foreground}:${quiet}:${value}`, 1280, 420, (ctx, w, h) => {
    fittedText(ctx, value, w / 2, h * 0.16, w * 0.95, quiet ? 150 : 210, p.foreground, {
      align: 'center',
      weight: quiet ? 500 : 600,
      maxLines: 2,
      lineHeight: 1.03,
    })
  })
}
export function iconSurface(scene: MotionScene, i: number, p: FilmPalette) {
  return texture(scene, `icon:${p.background}:${i}`, 320, 320, (ctx, w, h) => {
    const fill = ctx.createLinearGradient(0, 0, w, h)
    fill.addColorStop(0, tint(p.background, p.foreground, 0.2))
    fill.addColorStop(1, p.background)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(8, 8, w - 16, h - 16, 72)
    ctx.fill()
    ctx.strokeStyle = tint(p.background, p.foreground, 0.3)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.strokeStyle = p.foreground
    ctx.lineWidth = 15
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (i % 3 === 0) {
      for (const offset of [-1, 0, 1]) {
        ctx.beginPath()
        ctx.moveTo(97 + offset * 22, 110)
        ctx.lineTo(175 + offset * 22, 210)
        ctx.stroke()
      }
    } else if (i % 3 === 1) {
      for (const x of [95, 165]) {
        ctx.beginPath()
        ctx.moveTo(x, 95)
        ctx.lineTo(x + 60, 160)
        ctx.lineTo(x, 225)
        ctx.stroke()
      }
    } else {
      for (let x = 100; x <= 210; x += 55) {
        ctx.beginPath()
        ctx.moveTo(x, 110)
        ctx.lineTo(x, 210 - (x - 100) * 0.4)
        ctx.stroke()
      }
    }
  })
}
export function workspaceSurface(scene: MotionScene, p: FilmPalette, image?: CanvasImageSource) {
  // Uploaded evidence replaces the original illustrative workspace without changing its camera.
  if (image)
    return texture(scene, `upload:${p.background}`, 1280, 800, (ctx, w, h) =>
      drawImageCover(ctx, image, 0, 0, w, h),
    )
  return texture(scene, `workspace:${p.background}`, 1280, 800, (ctx, w, h) => {
    roundRect(ctx, 1, 1, w - 2, h - 2, 32, tint(p.background, p.foreground, 0.045))
    ctx.strokeStyle = tint(p.background, p.foreground, 0.2)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = tint(p.background, p.foreground, 0.07)
    ctx.fillRect(0, 0, w, 68)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = p.muted
      ctx.beginPath()
      ctx.arc(30 + i * 20, 34, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    fittedText(ctx, scene.label || 'Workspace', 130, 22, 600, 22, p.muted, { weight: 400 })
    fittedText(ctx, scene.headline, 72, 126, w - 144, 62, p.foreground, {
      maxLines: 2,
      lineHeight: 1.05,
    })
    fittedText(ctx, scene.body, 72, 280, w - 144, 23, p.muted, { maxLines: 2, weight: 400 })
    const labels = scene.items.length ? scene.items.slice(0, 3) : ['Ideas', 'In progress', 'Ready']
    const gap = 24,
      cell = (w - 144 - gap * 2) / 3
    labels.forEach((label, i) => {
      const x = 72 + i * (cell + gap)
      fittedText(ctx, label, x, 392, cell, 24, p.foreground, { weight: 500, maxLines: 1 })
      ctx.fillStyle = tint(p.background, p.foreground, 0.2)
      ctx.fillRect(x, 434, cell, 1)
      for (let j = 0; j < 2; j++) {
        const y = 464 + j * 112
        roundRect(ctx, x, y, cell, 94, 14, tint(p.background, p.foreground, 0.08))
        fittedText(
          ctx,
          ['A first thought', 'Make it tangible', 'Next chapter'][(i + j) % 3]!,
          x + 18,
          y + 20,
          cell - 36,
          22,
          p.foreground,
          { weight: 400, maxLines: 1 },
        )
        ctx.fillStyle = p.accent
        ctx.fillRect(x + 18, y + 62, 38 + i * 16, 3)
      }
    })
    fittedText(ctx, 'Illustrative workspace', 72, h - 45, 450, 17, p.muted, { weight: 400 })
  })
}
