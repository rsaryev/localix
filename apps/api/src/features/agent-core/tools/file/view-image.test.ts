import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { base64Bytes, createViewImageTool, isViewableImagePath } from './view-image'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const signal = () => new AbortController().signal

describe('base64Bytes', () => {
  test('handles empty, unpadded, and padded inputs', () => {
    expect(base64Bytes('')).toBe(0)
    expect(base64Bytes('YWJj')).toBe(3)
    expect(base64Bytes('YWI=')).toBe(2)
    expect(base64Bytes('YQ==')).toBe(1)
  })
})

describe('view_image', () => {
  let tempDir: string
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-view-image-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('a PNG becomes a native image content part with its size in the details', async () => {
    await writeFile(path.join(tempDir, 'pixel.png'), PIXEL_PNG)
    const tool = createViewImageTool(undefined, tempDir)
    const result = await tool.execute('v1', { path: 'pixel.png' }, signal())
    expect(result.isError).toBeFalsy()
    expect(result.contentParts).toEqual([
      expect.objectContaining({ type: 'image', mediaType: 'image/png' }),
    ])
    expect(result.details).toMatchObject({
      kind: 'image',
      mediaType: 'image/png',
      name: 'pixel.png',
    })
    expect((result.details as { bytes: number }).bytes).toBe(PIXEL_PNG.byteLength)
  })

  test('a non-image is refused with a pointer to read — never decoded into garbage', async () => {
    await writeFile(path.join(tempDir, 'notes.txt'), 'plain text')
    const tool = createViewImageTool(undefined, tempDir)
    const result = await tool.execute('v2', { path: 'notes.txt' }, signal())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not a supported image')
    expect(result.contentParts).toBeUndefined()
  })

  test('a missing file is an error result, not an empty image', async () => {
    const tool = createViewImageTool(undefined, tempDir)
    const result = await tool.execute('v3', { path: 'missing.png' }, signal())
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Failed to load image')
    expect(result.contentParts).toBeUndefined()
  })

  test('isViewableImagePath is the one rule read defers to', () => {
    expect(isViewableImagePath('/a/b.PNG')).toBe(true)
    expect(isViewableImagePath('/a/b.webp')).toBe(true)
    expect(isViewableImagePath('/a/b.pdf')).toBe(false)
    expect(isViewableImagePath('/a/b.ts')).toBe(false)
  })
})
