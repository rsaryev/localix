import { sceneSchema } from './schema'
import { cameraTrack } from './camera-presets'

// One continuous prototype: type -> dock close-up -> isolated mark -> product -> pullback.
export function createSpatialRelay() {
  const duration = 8
  return [
    sceneSchema.parse({
      id: crypto.randomUUID(),
      layout: 'showcase',
      headline: 'Ideas, connected.\nBuild something great.',
      duration,
      transition: 'cut',
      label: 'Relay',
      body: 'An illustrative creative workspace.',
      items: ['Collect', 'Connect', 'Create'],
      camera: cameraTrack(duration, [
        { at: 0, z: 1.9 },
        { at: 0.15, z: 1.6 },
        { at: 0.24, x: 0, z: 0.52, easing: 'out' },
        { at: 0.4, x: 0, z: 2.65 },
        { at: 0.51, x: 0, z: 2.55 },
        { at: 0.64, x: -0.33, y: -0.15, z: 0.9, easing: 'out' },
        { at: 0.79, x: 0, y: 0, z: 1.5 },
        { at: 0.94, z: 2.15 },
      ]),
    }),
  ]
}
