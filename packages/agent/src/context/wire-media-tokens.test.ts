import { describe, expect, test } from 'bun:test'
import type { Message, ImageContent } from '../types'
import { estimateWireMessageTokens, IMAGE_TOKEN_ESTIMATE } from './tokens'

const image = (size: number): ImageContent => ({
  type: 'image',
  mediaType: 'image/png',
  data: 'A'.repeat(size),
})

describe('wire media accounting', () => {
  test('transport image size cannot trigger text-token pressure', () => {
    const message = (size: number): Message => ({
      role: 'user',
      content: [image(size)],
      timestamp: 0,
    })
    const small = estimateWireMessageTokens(message(100))
    expect(estimateWireMessageTokens(message(1_000_000))).toBe(small)
    expect(small).toBeGreaterThanOrEqual(IMAGE_TOKEN_ESTIMATE)
    expect(small).toBeLessThan(IMAGE_TOKEN_ESTIMATE + 100)
  })

  test('tool result images count once, excluding codec mirrors and display-only details', () => {
    const content = [{ type: 'text' as const, text: 'Screenshot' }, image(800_000)]
    const message: Message = {
      role: 'tool',
      timestamp: 0,
      results: [{ type: 'tool_result', toolCallId: 'shot', toolName: 'preview', content }],
    }
    const mirrored = { ...message, content, details: { data: 'x'.repeat(800_000) } }
    expect(estimateWireMessageTokens(mirrored)).toBe(estimateWireMessageTokens(message))
    expect(estimateWireMessageTokens(message)).toBeLessThan(IMAGE_TOKEN_ESTIMATE + 150)
  })

  test('image-shaped tool arguments remain text and genuine large text remains large', () => {
    const message: Message = {
      role: 'assistant',
      model: 'm',
      timestamp: 0,
      content: [{ type: 'tool_call', id: 'write', name: 'Write', arguments: image(800_000) }],
    }
    expect(estimateWireMessageTokens(message)).toBeGreaterThan(200_000)
    expect(
      estimateWireMessageTokens({ role: 'user', content: 'x'.repeat(800_000), timestamp: 0 }),
    ).toBeGreaterThan(200_000)
  })
})
