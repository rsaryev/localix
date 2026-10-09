import type { SpatialStage } from './spatial-context'
import { fittedText, roundRect, drawImageCover } from './graphics'
import { texture, tint } from './spatial-textures'

export function portfolio(stage: SpatialStage, image?: CanvasImageSource) {
  const { scene, p, beat, plane } = stage
  const insert = beat(0.34, 0.22),
    finish = beat(0.58, 0.18)
  const page = texture(
    scene,
    `portfolio:${p.background}:${Boolean(image)}`,
    1000,
    1400,
    (ctx, w, h) => {
      roundRect(ctx, 1, 1, w - 2, h - 2, 20, tint(p.background, p.foreground, 0.045))
      ctx.strokeStyle = tint(p.background, p.foreground, 0.2)
      ctx.lineWidth = 2
      ctx.stroke()
      fittedText(ctx, scene.label || 'Field notes', 72, 60, 850, 26, p.foreground, { weight: 500 })
      fittedText(ctx, scene.headline, 72, 176, 856, 106, p.foreground, {
        family: 'Georgia, "Times New Roman", serif',
        weight: 400,
        maxLines: 3,
        lineHeight: 1.04,
      })
      fittedText(ctx, scene.body, 72, 488, 790, 30, p.muted, { weight: 400, maxLines: 3 })
      roundRect(ctx, 72, 650, 856, 455, 14, tint(p.background, p.foreground, 0.09))
      fittedText(ctx, 'Selected work', 110, 706, 778, 42, p.foreground, { weight: 500 })
      ctx.strokeStyle = p.accent
      ctx.lineWidth = 2
      ctx.setLineDash([10, 10])
      ctx.strokeRect(110, 784, 778, 264)
      ctx.setLineDash([])
      fittedText(ctx, 'A new perspective', 499, 878, 710, 50, p.foreground, {
        align: 'center',
        family: 'Georgia, "Times New Roman", serif',
        weight: 400,
      })
      fittedText(ctx, 'Illustrative editorial page', 72, 1300, 856, 23, p.muted, { weight: 400 })
    },
  )
  const pose = { x: 0, y: 0.08, z: -0.06, yaw: -12 * (1 - finish), roll: -5 * (1 - finish) }
  plane(page, 1.05, 1.47, pose)
  const file = texture(scene, `file:${p.background}`, 400, 460, (ctx, w, h) => {
    roundRect(ctx, 5, 5, w - 10, h - 10, 20, p.background)
    ctx.strokeStyle = tint(p.background, p.foreground, 0.4)
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = p.accent
    ctx.fillRect(54, 60, 292, 210)
    fittedText(ctx, scene.label || 'Field notes', 52, 324, 296, 44, p.foreground, {
      weight: 500,
      maxLines: 2,
    })
  })
  plane(
    file,
    0.2 * (1 - insert) + 0.13 * insert,
    0.23 * (1 - insert) + 0.15 * insert,
    { x: -0.65 * (1 - insert), y: 0.25, z: 0.18 * (1 - insert), roll: -12 * (1 - insert) },
    beat(0.24, 0.08) * (1 - finish),
  )
  const work = texture(scene, `work:${p.background}:${Boolean(image)}`, 800, 290, (ctx, w, h) => {
    if (image) drawImageCover(ctx, image, 0, 0, w, h)
    else {
      ctx.fillStyle = p.accent
      ctx.fillRect(0, 0, w, h)
      fittedText(ctx, scene.label || 'Field notes', w / 2, 72, w - 100, 110, p.background, {
        align: 'center',
        family: 'Georgia, "Times New Roman", serif',
        weight: 400,
        maxLines: 1,
      })
    }
  })
  plane(work, 0.79, 0.286, { x: 0, y: 0.325, z: -0.058 }, finish)
}
