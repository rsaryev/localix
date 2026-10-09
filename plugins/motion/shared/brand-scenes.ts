import { layerSchema } from './schema'
import { filmShot as shot } from './film-shot'
import { cameraTrack } from './camera-presets'

export function createBrandScenes() {
  return [
    shot('typeset', 'SHAPE\nA NEW\nFEELING.', { duration: 3 }),
    shot('custom', 'Soft signal.', {
      duration: 4,
      camera: cameraTrack(4, [
        { at: 0, x: -0.12, z: 0.86, roll: -8 },
        { at: 0.4, x: 0.1, z: 1.3, roll: 3 },
        { at: 0.84, x: 0, z: 1.5, roll: 0 },
      ]),
      layers: [
        ...[0, 1, 2].map((i) =>
          layerSchema.parse({
            id: crypto.randomUUID(),
            kind: 'rectangle',
            width: 0.055,
            height: 0.36,
            color: i === 2 ? 'foreground' : 'accent',
            depth: -i * 0.065,
            tiltY: -8 + i * 8,
            keyframes: [
              { time: 0, x: 0.3 + i * 0.2, y: 0.3 + i * 0.18, rotation: -65, scale: 0.9 },
              {
                time: 1.25 + i * 0.12,
                x: 0.43 + i * 0.075,
                y: 0.46,
                rotation: -32,
                easing: 'smooth',
              },
              { time: 3.36, x: 0.43 + i * 0.075, y: 0.46, rotation: -32 },
            ],
          }),
        ),
        layerSchema.parse({
          id: crypto.randomUUID(),
          kind: 'text',
          text: 'Soft signal.',
          width: 0.7,
          height: 0.1,
          fontSize: 0.075,
          keyframes: [
            { time: 0, x: 0.5, y: 0.84, opacity: 0 },
            { time: 1.65, x: 0.5, y: 0.81, opacity: 0 },
            { time: 2.1, x: 0.5, y: 0.8, opacity: 1 },
          ],
        }),
      ],
    }),
    shot('typeset', 'Soft\nsignal.', {
      duration: 3,
      body: 'Small gestures. Lasting impressions.',
    }),
  ]
}
