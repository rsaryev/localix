import type { CameraFrame, MotionCamera } from './schema'
import { ease } from './timing'

export type Point3 = { x: number; y: number; z: number }
export type SurfacePose = Point3 & { pitch?: number; yaw?: number; roll?: number }
const radians = (degrees: number) => (degrees * Math.PI) / 180
export function rotatePoint(point: Point3, pitch = 0, yaw = 0, roll = 0): Point3 {
  const a = radians(pitch),
    b = radians(yaw),
    c = radians(roll)
  const y = point.y * Math.cos(a) - point.z * Math.sin(a)
  const z = point.y * Math.sin(a) + point.z * Math.cos(a)
  const x = point.x * Math.cos(b) + z * Math.sin(b)
  const depth = -point.x * Math.sin(b) + z * Math.cos(b)
  return { x: x * Math.cos(c) - y * Math.sin(c), y: x * Math.sin(c) + y * Math.cos(c), z: depth }
}
export function surfacePoint(point: Point3, pose: SurfacePose): Point3 {
  const rotated = rotatePoint(point, pose.pitch, pose.yaw, pose.roll)
  return { x: pose.x + rotated.x, y: pose.y + rotated.y, z: pose.z + rotated.z }
}
export function sampleCamera(camera: MotionCamera, time: number): CameraFrame {
  const first = camera.frames[0]!
  if (time <= first.time) return first
  const index = camera.frames.findIndex((frame) => frame.time >= time)
  if (index < 0) return camera.frames.at(-1)!
  const a = camera.frames[index - 1]!,
    b = camera.frames[index]!
  const t = ease((time - a.time) / (b.time - a.time), b.easing)
  const mix = (key: 'x' | 'y' | 'z' | 'pitch' | 'yaw' | 'roll') => a[key] + (b[key] - a[key]) * t
  return {
    ...b,
    x: mix('x'),
    y: mix('y'),
    z: mix('z'),
    pitch: mix('pitch'),
    yaw: mix('yaw'),
    roll: mix('roll'),
  }
}
export function projectPoint(
  point: Point3,
  camera: CameraFrame,
  fov: number,
  w: number,
  h: number,
) {
  // Inverse camera rotations run in reverse order; objects and the stage share this view.
  let p = rotatePoint(
    { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z },
    0,
    0,
    -camera.roll,
  )
  p = rotatePoint(p, 0, -camera.yaw, 0)
  p = rotatePoint(p, -camera.pitch, 0, 0)
  const depth = -p.z
  if (depth < 0.08) return null
  const scale = h / (2 * Math.tan(radians(fov / 2)) * depth)
  return { x: w / 2 + p.x * scale, y: h / 2 + p.y * scale, depth, scale }
}
