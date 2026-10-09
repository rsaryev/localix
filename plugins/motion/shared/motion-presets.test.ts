import { expect, test } from 'bun:test'
import { keyframeSchema, layerSchema } from './schema'
import { presetKeyframes, motionPresets } from './motion-presets'
import { sampleLayer } from './timing'

test('presets remain seekable inside a one-second scene, including extreme allowed transforms', () => {
  const anchor = keyframeSchema.parse({ time: 0, x: -2, y: 0.5, scale: 10, rotation: -720 })
  for (const preset of motionPresets) {
    const frames = presetKeyframes(preset, 1, anchor)
    expect(
      layerSchema.safeParse({ id: crypto.randomUUID(), kind: 'ring', keyframes: frames }).success,
    ).toBe(true)
    expect(frames.every((frame) => frame.time <= 1)).toBe(true)
    expect(sampleLayer(frames, 10)).toEqual(frames.at(-1)!)
  }
  const normal = keyframeSchema.parse({ time: 0, x: 0.5, y: 0.5 })
  const glide = presetKeyframes('glide', 4, normal)
  expect(sampleLayer(glide, 0.4).x).toBeGreaterThan(glide[0]!.x)
  expect(sampleLayer(glide, 0.4).x).toBeLessThan(normal.x)
})
