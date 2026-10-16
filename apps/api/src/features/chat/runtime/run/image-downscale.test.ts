import { USER_PARTICIPANT } from '../../../../db'
import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../../../db/payload'
import type { ImageMediaType } from '@localixai/agent/images/downscale'
import {
  downscaleRunImages,
  IMAGE_DOWNSCALE_ATTACHMENT_CONCURRENCY,
  IMAGE_DOWNSCALE_PAYLOAD_CONCURRENCY,
} from './image-downscale'

function payload(index: number, imageCount: number): StoredMessagePayload {
  return {
    id: `message-${index}`,
    role: 'user',
    from: USER_PARTICIPANT,
    content: `payload ${index}`,
    bindings: Array.from({ length: imageCount }, (_, image) => ({
      kind: 'image' as const,
      mediaType: 'image/png',
      data: `${index}:${image}`,
      name: `${index}-${image}.png`,
      size: 10,
    })),
  }
}

describe('downscaleRunImages backpressure', () => {
  test('bounds concurrent image decodes while preserving payload and attachment order', async () => {
    let active = 0
    let peak = 0
    const inputs = Array.from({ length: 8 }, (_, index) => payload(index, 6))
    const outputs = await downscaleRunImages(inputs, async (data, mediaType: ImageMediaType) => {
      active += 1
      peak = Math.max(peak, active)
      await Bun.sleep(2)
      active -= 1
      return {
        data: `scaled:${data}`,
        mediaType,
        resized: true,
        beforeBytes: 10,
        afterBytes: 5,
        width: 100,
        height: 100,
      }
    })

    expect(peak).toBeLessThanOrEqual(
      IMAGE_DOWNSCALE_PAYLOAD_CONCURRENCY * IMAGE_DOWNSCALE_ATTACHMENT_CONCURRENCY,
    )
    expect(peak).toBeGreaterThan(1)
    expect(outputs.map((entry) => entry.content)).toEqual(inputs.map((entry) => entry.content))
    expect(
      outputs[3]?.bindings?.flatMap((binding) => (binding.kind === 'image' ? [binding.data] : [])),
    ).toEqual(Array.from({ length: 6 }, (_, index) => `scaled:3:${index}`))
  })

  test('does not invoke the decoder for unsupported or file-backed images', async () => {
    let calls = 0
    const input = payload(0, 1)
    input.bindings = [
      { kind: 'image', mediaType: 'image/webp', data: 'inline', name: 'x.webp', size: 1 },
      { kind: 'image', mediaType: 'image/png', name: 'x.png', size: 1 },
    ]

    const output = await downscaleRunImages([input], async () => {
      calls += 1
      throw new Error('must not run')
    })
    expect(calls).toBe(0)
    expect(output[0]).toBe(input)
  })
})
