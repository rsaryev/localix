import type { SpatialStage } from './spatial-context'
import { texture, iconSurface, wordSurface, workspaceSurface, tint } from './spatial-textures'
export function showcase(stage: SpatialStage, image?: CanvasImageSource) {
  const { scene, p, beat, q, plane } = stage
  const opening = 1 - beat(0.15, 0.055)
  plane(
    wordSurface(scene, scene.headline.split('\n')[0]!, p, true),
    1.8,
    0.6,
    { x: 0, y: -0.08, z: 0.05 },
    opening,
    Math.sin(Math.PI * beat(0.13, 0.04)) * 4,
  )
  const dockIn = beat(0.16, 0.1),
    isolation = beat(0.33, 0.07),
    handoff = beat(0.5, 0.05),
    surface = beat(0.55, 0.08),
    wall = beat(0.82, 0.12)
  const dock = texture(scene, `dock:${p.background}`, 1024, 300, (ctx, w, h) => {
    ctx.fillStyle = tint(p.background, p.foreground, 0.08)
    ctx.beginPath()
    ctx.roundRect(2, 2, w - 4, h - 4, 64)
    ctx.fill()
    ctx.strokeStyle = tint(p.background, p.foreground, 0.25)
    ctx.lineWidth = 2
    ctx.stroke()
  })
  plane(dock, 0.99, 0.29, { x: 1.7 * (1 - dockIn), y: 0, z: -0.05 }, dockIn * (1 - isolation))
  for (let i = 0; i < 3; i++) {
    const active = i === 1
    const x = (i - 1) * 0.3 + 1.7 * (1 - dockIn)
    const alpha = dockIn * (active ? 1 - surface : 1 - isolation)
    const size = active ? 0.245 * (1 - handoff) + 0.035 * handoff : 0.245
    plane(
      iconSurface(scene, i, p),
      size,
      size,
      {
        x: active ? x - 0.662 * handoff : x,
        y: active ? -0.423 * handoff : 0,
        z: 0.08 + isolation * 0.15 - handoff * 0.315,
        yaw: (1 - dockIn) * -25,
      },
      alpha,
      Math.sin(Math.PI * isolation) * 3,
    )
  }
  const screen = workspaceSurface(scene, p, image)
  plane(screen, 1.58, 0.99, { x: 0, y: 0.03, z: -0.1, yaw: (1 - surface) * -9 }, surface)
  // The camera retreats into a coherent wall: the same workspace, at different depths.
  for (const i of [-1, 1]) {
    plane(screen, 1.15, 0.72, { x: i * 1.1, y: i * 0.17, z: -0.55, yaw: i * -12 }, wall)
  }
  if (q > 0.89)
    plane(
      wordSurface(scene, scene.label, p, true),
      0.65,
      0.22,
      { x: 0, y: 0.84, z: 0 },
      beat(0.89, 0.05),
    )
}
