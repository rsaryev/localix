import type { MotionScene, CameraFrame } from './schema'
import type { Painter, FilmPalette } from './graphics'
import { projectPoint, sampleCamera, type SurfacePose } from './camera'
import { projectSurface, type FilmSurface } from './perspective'
import { reveal } from './graphics'

export type SpatialStage = ReturnType<typeof spatialStage>
export function spatialStage(ctx: Painter, scene: MotionScene, time: number, p: FilmPalette) {
  const track = scene.camera ?? {
    fov: 50,
    frames: [{ time: 0, x: 0, y: 0, z: 2.4, pitch: 0, yaw: 0, roll: 0, easing: 'smooth' as const }],
  }
  const camera: CameraFrame = { ...sampleCamera(track, time) }
  const { width: w, height: h } = ctx.canvas
  // Preserve the landscape stage when a user reviews a narrower delivery format.
  camera.z *= Math.max(1, 0.9 / (w / h))
  const jobs: { depth: number; draw: () => void }[] = []
  const object = (pose: SurfacePose, draw: () => void) => {
    const point = projectPoint(pose, camera, track.fov, w, h)
    if (point) jobs.push({ depth: point.depth, draw })
  }
  const plane = (
    image: FilmSurface,
    width: number,
    height: number,
    pose: SurfacePose,
    opacity = 1,
    blur = 0,
  ) => {
    if (opacity <= 0.001) return
    object(pose, () => {
      ctx.save()
      ctx.globalAlpha *= opacity
      if (blur > 0.1) ctx.filter = `blur(${(blur * h) / 720}px)`
      projectSurface(ctx, image, width, height, pose, camera, track.fov)
      ctx.restore()
    })
  }
  const q = time / scene.duration
  const beat = (start: number, length = 0.1) => reveal(q, start, length)
  const render = () => jobs.sort((a, b) => b.depth - a.depth).forEach((job) => job.draw())
  return { ctx, scene, time, p, camera, fov: track.fov, w, h, q, beat, plane, object, render }
}
