import type { SpatialStage } from './spatial-context'
import { projectPoint, rotatePoint, surfacePoint, type SurfacePose } from './camera'
import { texture, tint } from './spatial-textures'
import { lettering } from './spatial-type'

export function token(stage: SpatialStage) {
  const { scene, p, beat, plane, object, ctx, camera, fov, w, h } = stage
  const turn = beat(0.02, 0.57),
    resolve = beat(0.5, 0.26)
  const pose: SurfacePose = {
    x: 0.05 + 0.48 * resolve,
    y: 0,
    z: 0.05,
    yaw: -65 + 105 * turn - 28 * resolve,
    pitch: 14 * (1 - resolve),
    roll: -20 * (1 - resolve),
  }
  const radius = 0.34,
    thickness = 0.075
  const face = texture(scene, `token:${p.background}`, 1024, 1024, (painter) => {
    const metal = painter.createLinearGradient(110, 90, 850, 940)
    metal.addColorStop(0, p.foreground)
    metal.addColorStop(0.16, p.accent)
    metal.addColorStop(0.6, tint(p.background, p.accent, 0.7))
    metal.addColorStop(1, p.background)
    painter.fillStyle = metal
    painter.beginPath()
    painter.arc(512, 512, 498, 0, Math.PI * 2)
    painter.fill()
    painter.strokeStyle = tint(p.accent, p.foreground, 0.7)
    painter.lineWidth = 8
    painter.stroke()
    painter.strokeStyle = p.foreground
    painter.lineWidth = 30
    painter.lineCap = 'round'
    for (const offset of [-90, 0, 90]) {
      painter.beginPath()
      painter.moveTo(420 + offset, 365)
      painter.lineTo(590 + offset, 655)
      painter.stroke()
    }
  })
  // A real cylindrical edge: lit facets share the same camera and object pose as both faces.
  for (let i = 0; i < 48; i++) {
    const a = (i * Math.PI * 2) / 48,
      b = ((i + 1) * Math.PI * 2) / 48
    const local = [
      { x: Math.cos(a) * radius, y: Math.sin(a) * radius, z: -thickness },
      { x: Math.cos(b) * radius, y: Math.sin(b) * radius, z: -thickness },
      { x: Math.cos(b) * radius, y: Math.sin(b) * radius, z: 0 },
      { x: Math.cos(a) * radius, y: Math.sin(a) * radius, z: 0 },
    ]
    const center = surfacePoint(
      { x: Math.cos((a + b) / 2) * radius, y: Math.sin((a + b) / 2) * radius, z: -thickness / 2 },
      pose,
    )
    const normal = rotatePoint(
      { x: Math.cos((a + b) / 2), y: Math.sin((a + b) / 2), z: 0 },
      pose.pitch,
      pose.yaw,
      pose.roll,
    )
    object(center, () => {
      const points = local.map((point) =>
        projectPoint(surfacePoint(point, pose), camera, fov, w, h),
      )
      if (points.some((point) => !point)) return
      ctx.fillStyle = tint(
        p.background,
        p.accent,
        0.28 + 0.65 * Math.max(0, -normal.x * 0.6 - normal.y * 0.8),
      )
      ctx.beginPath()
      points.forEach((point, index) =>
        index ? ctx.lineTo(point!.x, point!.y) : ctx.moveTo(point!.x, point!.y),
      )
      ctx.closePath()
      ctx.fill()
    })
  }
  plane(face, radius * 2, radius * 2, {
    ...pose,
    ...surfacePoint({ x: 0, y: 0, z: -thickness }, pose),
  })
  plane(face, radius * 2, radius * 2, pose)
  plane(
    lettering(scene, scene.headline.split('\n')[0]!, p, 600, undefined, 1.03 / 0.24),
    1.03,
    0.24,
    { x: -0.56, y: -0.13, z: 0 },
    beat(0.46, 0.14),
  )
  if (scene.headline.includes('\n'))
    plane(
      lettering(
        scene,
        scene.headline.split('\n').slice(1).join(' '),
        p,
        600,
        undefined,
        1.03 / 0.24,
      ),
      1.03,
      0.24,
      { x: -0.56, y: 0.13, z: 0 },
      beat(0.5, 0.14),
    )
}
