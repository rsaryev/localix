import { describe, expect, test } from 'bun:test'
import { pngDimensions } from './png.mjs'

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

describe('PNG dimensions', () => {
  test('reads PNG dimensions from the IHDR header', () => {
    expect(pngDimensions(pngHeader(1600, 1000))).toEqual({ width: 1600, height: 1000 })
    expect(() => pngDimensions(Buffer.from('not png'))).toThrow('not a PNG file')
  })
})
