import { keyframeSchema, type Keyframe } from './schema'

export const motionPresets = ['pop', 'glide', 'pulse', 'turn'] as const
export function presetKeyframes(
  preset: (typeof motionPresets)[number],
  duration: number,
  anchor: Keyframe,
): Keyframe[] {
  const at = (time: number, patch: Partial<Keyframe>) =>
    keyframeSchema.parse({ ...anchor, time, ...patch })
  const end = Math.min(0.8, duration * 0.4)
  if (preset === 'pop')
    return [at(0, { scale: 0, opacity: 0, easing: 'spring' }), at(end, { scale: 1, opacity: 1 })]
  if (preset === 'glide')
    return [
      at(0, { x: Math.max(-2, anchor.x - 0.18), opacity: 0, easing: 'out' }),
      at(end, { opacity: 1 }),
    ]
  if (preset === 'turn')
    return [
      at(0, {
        rotation: Math.max(-720, anchor.rotation - 90),
        scale: 0.75,
        opacity: 0,
        easing: 'out',
      }),
      at(end, { scale: 1, opacity: 1 }),
    ]
  return [
    at(0, { easing: 'smooth' }),
    at(duration * 0.5, { scale: Math.min(10, anchor.scale * 1.15), easing: 'smooth' }),
    at(duration, {}),
  ]
}
