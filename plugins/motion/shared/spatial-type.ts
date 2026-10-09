import type { SpatialStage } from './spatial-context'
import type { MotionScene } from './schema'
import { fittedText, type FilmPalette } from './graphics'
import { texture } from './spatial-textures'

export function lettering(
  scene: MotionScene,
  value: string,
  p: FilmPalette,
  weight = 600,
  family = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  aspect = 1.7 / 0.29,
) {
  const height = Math.round(1536 / aspect)
  return texture(
    scene,
    `letter:${p.foreground}:${weight}:${family}:${aspect}:${value}`,
    1536,
    height,
    (ctx) => {
      // Texture and world plane share an aspect ratio, so lettering keeps its actual proportions.
      fittedText(ctx, value, 768, height * 0.13, 1456, height * 0.7, p.foreground, {
        align: 'center',
        weight,
        family,
        maxLines: 1,
      })
    },
  )
}
export function typeset(stage: SpatialStage) {
  const { scene, p, beat, plane, w, h } = stage
  const portrait = h > w * 1.2
  const lines = scene.headline.split('\n').slice(0, 4)
  const width = portrait ? 1 : 1.7
  const row = portrait ? 0.33 : 0.29
  const serif = scene.typeface === 'serif'
  const family = serif ? 'Georgia, "Times New Roman", serif' : undefined
  lines.forEach((line, i) => {
    const arrive = beat(0.02 + i * 0.045, 0.18)
    plane(
      lettering(scene, line, p, serif ? 400 : 600, family, width / row),
      width,
      row,
      {
        x: (1 - arrive) * (i % 2 ? 0.16 : -0.16),
        y: (i - (lines.length - 1) / 2) * row + (1 - arrive) * 0.17,
        z: -i * 0.07 * (1 - arrive),
        roll: (1 - arrive) * (i % 2 ? 6 : -6),
      },
      0.15 + arrive * 0.85,
      (1 - arrive) * 2,
    )
  })
  if (scene.body)
    plane(
      lettering(scene, scene.body, p, 400, undefined, (portrait ? 1 : 1.7) / 0.09),
      portrait ? 1 : 1.7,
      0.09,
      { x: 0, y: portrait ? 0.85 : 0.55, z: -0.08 },
      beat(0.35, 0.14),
    )
}
