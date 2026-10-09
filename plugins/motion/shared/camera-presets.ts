import { cameraSchema, type CameraFrame } from './schema'

export function cameraTrack(
  duration: number,
  points: (Partial<CameraFrame> & { at: number })[],
  fov = 50,
) {
  let pose = {
    x: 0,
    y: 0,
    z: 2.4,
    pitch: 0,
    yaw: 0,
    roll: 0,
    easing: 'smooth' as CameraFrame['easing'],
  }
  return cameraSchema.parse({
    fov,
    frames: points.map(({ at, ...patch }) => {
      pose = { ...pose, ...patch }
      return { ...pose, time: at * duration }
    }),
  })
}
