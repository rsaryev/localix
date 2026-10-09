import { cameraTrack } from './camera-presets'
import { sceneSchema, type MotionScene } from './schema'

export function filmShot(
  layout: MotionScene['layout'],
  headline: string,
  rest: Partial<MotionScene> = {},
) {
  const duration = rest.duration ?? 3.5
  const camera =
    layout === 'typeset'
      ? cameraTrack(duration, [
          { at: 0, z: 1.14, roll: -2 },
          { at: 0.32, z: 1.3, roll: 0, easing: 'out' },
          { at: 0.82, z: 1.38 },
        ])
      : cameraTrack(duration, [
          { at: 0, x: -0.035, z: 1.02, roll: -1 },
          { at: 0.32, x: 0, z: 1.1, roll: 0, easing: 'out' },
          { at: 0.82, z: 1.14 },
        ])
  return sceneSchema.parse({
    id: crypto.randomUUID(),
    layout,
    headline,
    duration,
    transition: 'cut',
    camera,
    ...rest,
  })
}
