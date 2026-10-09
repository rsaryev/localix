import type { z } from 'zod'
import { layerSchema, sceneSchema } from './schema'

const layer = (input: Omit<z.input<typeof layerSchema>, 'id'>) =>
  layerSchema.parse({ id: crypto.randomUUID(), ...input })
export function createBrandScenes() {
  return [
    sceneSchema.parse({
      id: crypto.randomUUID(),
      layout: 'custom',
      headline: 'Soft signal.',
      duration: 4,
      layers: [
        ...[0, 1, 2, 3].map((i) =>
          layer({
            kind: 'ring',
            width: 0.28,
            height: 0.7,
            color: i === 3 ? 'foreground' : 'accent',
            keyframes: [
              { time: 0, x: 0.72, y: 0.5, scale: 0, opacity: 0, easing: 'spring' },
              {
                time: 0.7 + i * 0.08,
                x: 0.64 + i * 0.055,
                y: 0.5,
                scale: 1,
                opacity: 1,
                easing: 'smooth',
              },
              { time: 4, x: 0.65 + i * 0.05, y: 0.5, scale: 1, opacity: 1 },
            ],
          }),
        ),
        layer({
          kind: 'text',
          text: 'Soft\nsignal.',
          width: 0.46,
          height: 0.3,
          fontSize: 0.14,
          keyframes: [
            { time: 0, x: 0.28, y: 0.5, opacity: 0 },
            { time: 0.8, x: 0.28, y: 0.5 },
          ],
        }),
        layer({
          kind: 'text',
          text: 'An independent brand study',
          width: 0.7,
          height: 0.1,
          fontSize: 0.023,
          color: 'muted',
          keyframes: [
            { time: 0, x: 0.5, y: 0.88, opacity: 0 },
            { time: 1.2, x: 0.5, y: 0.88 },
          ],
        }),
      ],
    }),
    sceneSchema.parse({
      id: crypto.randomUUID(),
      layout: 'poster',
      headline: 'SHAPE\nA NEW\nFEELING.',
      palette: 'rose',
      duration: 3.5,
      transition: 'wipe',
    }),
    sceneSchema.parse({
      id: crypto.randomUUID(),
      layout: 'editorial',
      headline: 'Soft\nsignal.',
      body: 'Small gestures. Lasting impressions.',
      duration: 4,
    }),
  ]
}
