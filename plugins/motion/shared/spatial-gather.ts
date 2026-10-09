import type { SpatialStage } from './spatial-context'
import { fittedText, roundRect } from './graphics'
import { texture, tint } from './spatial-textures'
import { lettering } from './spatial-type'

export function gather(stage: SpatialStage) {
  const { scene, p, beat, plane, q, w, h } = stage
  const portrait = h > w * 1.2
  const words = scene.headline.split('\n')
  const phase = q < 0.27 ? 0 : q < 0.58 ? Math.min(1, words.length - 1) : words.length - 1
  const phaseStart = phase === 0 ? 0 : phase === 1 ? 0.27 : 0.58
  const titleIn = beat(phaseStart, 0.08)
  plane(
    lettering(scene, words[phase]!, p, 600, undefined, (portrait ? 0.9 : 1.65) / 0.32),
    portrait ? 0.9 : 1.65,
    0.32,
    { x: 0, y: -0.48 + (1 - titleIn) * 0.07, z: 0 },
    0.2 + 0.8 * titleIn,
  )
  const items = scene.items.length ? scene.items : ['A thought', 'A connection', 'A direction']
  const count = Math.min(6, items.length)
  for (let i = count - 1; i >= 0; i--) {
    const enter = beat(0.07 + i * 0.015, 0.12)
    const stack = beat(0.34 + (count - i - 1) * 0.035, 0.2)
    const dense = portrait && count > 3
    const width = dense ? 0.42 * (1 - stack) + 0.72 * stack : portrait ? 0.72 : 0.64
    const card = texture(scene, `gather:${p.background}:${i}`, 720, 400, (ctx, cw, ch) => {
      roundRect(ctx, 2, 2, cw - 4, ch - 4, 26, tint(p.background, p.foreground, 0.07 + i * 0.02))
      ctx.strokeStyle = tint(p.background, p.foreground, 0.25)
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = p.accent
      ctx.fillRect(52, 56, 44, 5)
      fittedText(ctx, items[i]!, 52, 142, cw - 104, 62, p.foreground, { maxLines: 2, weight: 500 })
    })
    const initialX = dense
      ? ((i % 2) - 0.5) * 0.48
      : portrait
        ? i % 2
          ? 0.11
          : -0.11
        : ((i % 3) - 1) * 0.72
    const initialY = dense
      ? 0.06 + Math.floor(i / 2) * 0.33
      : portrait
        ? i * Math.min(0.41, 1.05 / Math.max(1, count - 1))
        : 0.18 + Math.floor(i / 3) * 0.4
    plane(
      card,
      width,
      (width * 400) / 720,
      {
        x: initialX * (1 - stack),
        y: initialY * (1 - stack) + (0.19 - i * 0.04) * stack + (1 - enter) * 0.14,
        z: -i * 0.055,
        roll: (i - (count - 1) / 2) * 5 * (1 - stack) - i * 2.5 * stack,
        yaw: (1 - stack) * (i % 2 ? 8 : -8),
      },
      enter,
    )
  }
  if (scene.body)
    plane(
      lettering(scene, scene.body, p, 400, undefined, (portrait ? 1 : 1.6) / 0.09),
      portrait ? 1 : 1.6,
      0.09,
      { x: 0, y: portrait ? 0.85 : 0.62, z: 0 },
      beat(0.7, 0.12),
    )
}
