import { expect, test } from 'bun:test'
import { documentSchema, layerSchema, templateIds } from './schema'
import { createTemplateDocument } from './templates'
import { dimensions, ease, framesOf, sceneAt, sampleLayer } from './timing'

test('all template types contain valid complete films in supported aspect ratios', () => {
  for (const template of templateIds) {
    const document = createTemplateDocument(template)
    expect(documentSchema.safeParse(document).success).toBe(true)
    expect(document.scenes.length).toBeGreaterThanOrEqual(template === 'blank' ? 1 : 3)
    expect(framesOf(document)).toBeGreaterThan(template === 'blank' ? 100 : 200)
  }
  expect(dimensions('portrait')).toEqual({ width: 1080, height: 1920 })
  expect(dimensions('landscape')).toEqual({ width: 1920, height: 1080 })
  expect(dimensions('square')).toEqual({ width: 1080, height: 1080 })
})
test('invalid IDs, duplicate identity, excessive duration and out-of-scene keyframes fail', () => {
  const document = createTemplateDocument('launch')
  expect(documentSchema.safeParse({ ...document, scenes: [] }).success).toBe(false)
  expect(
    documentSchema.safeParse({ ...document, scenes: [document.scenes[0], document.scenes[0]] })
      .success,
  ).toBe(false)
  expect(
    documentSchema.safeParse({
      ...document,
      scenes: Array.from({ length: 10 }, () => ({
        ...document.scenes[0],
        id: crypto.randomUUID(),
        duration: 20,
      })),
    }).success,
  ).toBe(false)
  const layer = layerSchema.parse({
    id: crypto.randomUUID(),
    kind: 'text',
    text: 'Hello',
    keyframes: [{ time: 0, x: 0.5, y: 0.5 }],
  })
  expect(
    layerSchema.safeParse({
      ...layer,
      keyframes: [
        { ...layer.keyframes[0], time: 2 },
        { ...layer.keyframes[0], time: 1 },
      ],
    }).success,
  ).toBe(false)
  const scene = {
    ...document.scenes[0]!,
    layers: [{ ...layer, keyframes: [{ ...layer.keyframes[0], time: 20 }] }],
  }
  expect(documentSchema.safeParse({ ...document, scenes: [scene] }).success).toBe(false)
})
test('seeking resolves exact scene boundaries and frame counts without a wall clock', () => {
  const document = createTemplateDocument('launch')
  expect(sceneAt(document, 0).index).toBe(0)
  expect(sceneAt(document, document.scenes[0]!.duration)).toMatchObject({ index: 1, local: 0 })
  expect(sceneAt(document, 1000).index).toBe(document.scenes.length - 1)
  expect(framesOf({ ...document, fps: 60 })).toBe(framesOf(document) * 2)
})
test('keyframes interpolate complete transforms, hold edges and clamp spring opacity', () => {
  const layer = layerSchema.parse({
    id: crypto.randomUUID(),
    kind: 'circle',
    keyframes: [
      { time: 0, x: 0, y: 0, scale: 0, opacity: 0 },
      { time: 1, x: 1, y: 1, scale: 1, rotation: 90, opacity: 1, easing: 'linear' },
    ],
  })
  expect(sampleLayer(layer.keyframes, 0.5)).toMatchObject({
    x: 0.5,
    y: 0.5,
    scale: 0.5,
    rotation: 45,
    opacity: 0.5,
  })
  expect(sampleLayer(layer.keyframes, -1)).toEqual(layer.keyframes[0]!)
  expect(sampleLayer(layer.keyframes, 2)).toEqual(layer.keyframes[1]!)
  expect(ease(0, 'spring')).toBe(0)
  expect(ease(1, 'spring')).toBe(1)
})
