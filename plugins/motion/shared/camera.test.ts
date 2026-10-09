import { expect, test } from 'bun:test'
import { cameraSchema, documentSchema } from './schema'
import { projectPoint, rotatePoint, sampleCamera } from './camera'
import { createTemplateDocument } from './templates'
import { retimeScene } from './retime-scene'

test('a dolly changes near objects more than the background and camera tracking changes framing', () => {
  const camera = cameraSchema.parse({
    frames: [
      { time: 0, z: 3 },
      { time: 2, x: 0.4, z: 1.5 },
    ],
  })
  const start = sampleCamera(camera, 0),
    end = sampleCamera(camera, 2)
  const nearStart = projectPoint({ x: 0.3, y: 0, z: 0 }, start, 50, 1920, 1080)!
  const nearEnd = projectPoint({ x: 0.3, y: 0, z: 0 }, end, 50, 1920, 1080)!
  const farStart = projectPoint({ x: 0.3, y: 0, z: -3 }, start, 50, 1920, 1080)!
  const farEnd = projectPoint({ x: 0.3, y: 0, z: -3 }, end, 50, 1920, 1080)!
  expect(nearEnd.scale / nearStart.scale).toBeGreaterThan(farEnd.scale / farStart.scale)
  expect(nearEnd.x).toBeLessThan(1920 / 2)
  expect(projectPoint({ x: 0, y: 0, z: 4 }, start, 50, 1920, 1080)).toBeNull()
})
test('camera sampling is deterministic, holds edges and rotates the whole view', () => {
  const camera = cameraSchema.parse({
    frames: [{ time: 0 }, { time: 1, x: 1, z: 2, roll: 30, easing: 'linear' }],
  })
  expect(sampleCamera(camera, 0.5)).toMatchObject({ x: 0.5, z: 2.2, roll: 15 })
  expect(sampleCamera(camera, -1)).toEqual(camera.frames[0]!)
  expect(sampleCamera(camera, 8)).toEqual(camera.frames[1]!)
  expect(rotatePoint({ x: 1, y: 0, z: 0 }, 0, 0, 90).y).toBeCloseTo(1)
})
test('legacy documents keep a stationary default; invalid camera tracks fail at authoring', () => {
  const document = createTemplateDocument('blank')
  expect(document.scenes[0]!.camera).toBeNull()
  expect(cameraSchema.safeParse({ frames: [{ time: 1 }, { time: 1 }] }).success).toBe(false)
  expect(cameraSchema.safeParse({ frames: [{ time: 0, z: 0 }] }).success).toBe(false)
  document.scenes[0]!.camera = cameraSchema.parse({ frames: [{ time: 8 }] })
  expect(documentSchema.safeParse(document).success).toBe(false)
})
test('changing scene duration retains the camera choreography inside its new duration', () => {
  const document = createTemplateDocument('relay')
  const scene = document.scenes[0]!
  const shorter = retimeScene(scene, 3)
  expect(shorter.camera!.frames.at(-1)!.time).toBeCloseTo(3 * 0.94)
  expect(shorter.camera!.frames[2]!.x).toBe(scene.camera!.frames[2]!.x)
  expect(scene.duration).toBe(8)
  expect(documentSchema.safeParse({ ...document, scenes: [shorter] }).success).toBe(true)
})
