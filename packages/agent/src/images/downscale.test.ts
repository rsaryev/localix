import { describe, expect, test } from 'bun:test'
import { Jimp } from 'jimp'
import { downscaleImage, downscaleImageCached } from './downscale'

async function pngBase64(width: number, height: number): Promise<string> {
  const buf = await new Jimp({ width, height, color: 0xff0000ff }).getBuffer('image/png')
  return buf.toString('base64')
}

describe('downscaleImage', () => {
  test('downscales a large png so the long edge ≤ maxEdge', async () => {
    const b64 = await pngBase64(3000, 2000)
    const r = await downscaleImage(b64, 'image/png', { maxEdge: 1568 })
    expect(r.resized).toBe(true)
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(1568)
    // aspect ratio preserved (3:2)
    expect(Math.round((r.width / r.height) * 10)).toBe(15)
    // fewer pixels after (→ fewer vision tokens)
    expect(r.width * r.height).toBeLessThan(3000 * 2000)
  }, 15_000)

  test('leaves a small image untouched', async () => {
    const b64 = await pngBase64(800, 600)
    const r = await downscaleImage(b64, 'image/png', { maxEdge: 1568 })
    expect(r.resized).toBe(false)
    expect(r.data).toBe(b64)
  }, 15_000)

  test('passes through formats jimp cannot round-trip (webp/gif)', async () => {
    const b64 = await pngBase64(3000, 2000) // bytes are png, but we claim webp
    const r = await downscaleImage(b64, 'image/webp', { maxEdge: 1568 })
    expect(r.resized).toBe(false)
    expect(r.data).toBe(b64)
  }, 15_000)

  test('returns the original on decode failure', async () => {
    const r = await downscaleImage('not-a-real-image', 'image/png')
    expect(r.resized).toBe(false)
    expect(r.data).toBe('not-a-real-image')
  })
})

describe('downscaleImageCached', () => {
  test('does not collide two distinct same-length images sharing head/tail', async () => {
    // Regression: the old fingerprint was length + first-24 + last-24 chars — two
    // distinct same-size screenshots share an identical PNG signature/IHDR head and
    // IEND tail, so that key aliased them and served the FIRST image's bytes for the
    // SECOND. webp passes through unchanged (no decode), so `data` echoes the input.
    const head = 'A'.repeat(24)
    const tail = 'Z'.repeat(24)
    const a = `${head}${'B'.repeat(40)}${tail}`
    const b = `${head}${'C'.repeat(40)}${tail}`
    expect(a.length).toBe(b.length)
    const ra = await downscaleImageCached(a, 'image/webp')
    const rb = await downscaleImageCached(b, 'image/webp')
    expect(ra.data).toBe(a)
    expect(rb.data).toBe(b) // under the old colliding key this returned `a`
  })

  test('serves a true cache hit (same bytes → same result object)', async () => {
    const b64 = await pngBase64(800, 600)
    const first = await downscaleImageCached(b64, 'image/png')
    const second = await downscaleImageCached(b64, 'image/png')
    expect(second).toBe(first) // identical reference = cache hit
  }, 15_000)
})
