import type { SpatialStage } from './spatial-context'
import { texture, tint } from './spatial-textures'
import { lettering } from './spatial-type'

export function chart(stage: SpatialStage) {
  const { scene, p, beat, plane } = stage
  const lines = scene.headline.split('\n').slice(0, 2)
  lines.forEach((line, i) =>
    plane(
      lettering(scene, line, p, 600, undefined, 0.94 / 0.17),
      0.94,
      0.17,
      { x: -0.62, y: -0.28 + i * 0.18, z: 0 },
      beat(0.02 + i * 0.02, 0.14),
    ),
  )
  plane(
    lettering(scene, `${scene.value}${scene.suffix}`, p, 600, undefined, 0.85 / 0.33),
    0.85,
    0.33,
    { x: -0.64, y: 0.18, z: 0.05 },
    beat(0.12, 0.18),
  )
  const series = scene.series.slice(0, 6)
  const maximum = Math.max(1, ...series.map((entry) => entry.value))
  const cell = 1.08 / Math.max(1, series.length)
  const fill = texture(scene, `bar:${p.accent}`, 160, 800, (ctx, w, h) => {
    const material = ctx.createLinearGradient(0, 0, w, 0)
    material.addColorStop(0, p.accent)
    material.addColorStop(1, tint(p.accent, p.background, 0.2))
    ctx.fillStyle = material
    ctx.fillRect(0, 0, w, h)
  })
  const edge = texture(scene, `bar-edge:${p.accent}`, 40, 800, (ctx, w, h) => {
    ctx.fillStyle = tint(p.accent, p.background, 0.4)
    ctx.fillRect(0, 0, w, h)
  })
  series.forEach((entry, i) => {
    const growth = beat(0.18 + i * 0.055, 0.22)
    const height = Math.max(0.002, (entry.value / maximum) * 0.66 * growth)
    const x = 0.03 + (i + 0.5) * cell
    plane(fill, cell * 0.64, height, { x, y: 0.38 - height / 2, z: 0.04 })
    plane(edge, 0.045, height, { x: x + cell * 0.32, y: 0.38 - height / 2, z: 0.015, yaw: 70 })
    plane(
      lettering(scene, entry.label, p, 400, undefined, (cell * 0.85) / 0.065),
      cell * 0.85,
      0.065,
      { x, y: 0.46, z: 0 },
      beat(0.32 + i * 0.03, 0.14),
    )
  })
  if (scene.body)
    plane(
      lettering(scene, scene.body, p, 400, undefined, 1.9 / 0.08),
      1.9,
      0.08,
      { x: 0, y: 0.65, z: 0 },
      beat(0.6, 0.12),
    )
}
