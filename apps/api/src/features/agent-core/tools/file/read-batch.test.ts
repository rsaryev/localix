import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReadTool } from './read'
import { createFileMtimeStore } from './file-utils'
import { MAX_BATCH_IMAGES, MAX_BATCH_TEXT_BYTES } from './read-batch'
import { MAX_READ_ITEMS, readItems } from './read-items'
import { readToolInputSchema } from './read-input'

/** A 1×1 PNG. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'localix-read-batch-'))
})
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

const lines = (label: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${label} ${i + 1}`).join('\n')

describe('read with several files', () => {
  test('text, image and a missing file in one call: each answered, the call not failed', async () => {
    await writeFile(path.join(dir, 'a.ts'), lines('alpha', 5))
    await writeFile(path.join(dir, 'pixel.png'), PIXEL_PNG)
    const updates: unknown[] = []
    const result = await createReadTool(undefined, dir).execute(
      'b1',
      {
        reads: [
          { path: 'a.ts', start_line: 2, end_line: 3 },
          { path: 'pixel.png' },
          { path: 'nope.ts' },
        ],
      },
      undefined,
      (details) => updates.push(details),
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain(`### ${path.join(dir, 'a.ts')} (L2-3)`)
    expect(result.content).toContain('alpha 2')
    expect(result.content).not.toContain('alpha 4')
    expect(result.content).toContain('[image 1 of this call, below]')
    expect(result.content).toContain(`File not found: ${path.join(dir, 'nope.ts')}`)
    expect(result.contentParts?.map((part) => part.type)).toEqual(['text', 'image'])
    // One update, the same object the call returns — what the card renders.
    expect(updates).toEqual([result.details])
    expect(result.details?.items?.map((item) => [item.range, item.kind, item.isError])).toEqual([
      ['L2-3', undefined, undefined],
      [undefined, 'image', undefined],
      [undefined, undefined, true],
    ])
    expect(result.sources?.map((source) => source.status)).toEqual([
      'available',
      'available',
      'failed',
    ])
  })

  test('the call fails only when every file failed', async () => {
    const result = await createReadTool(undefined, dir).execute('b2', {
      reads: [{ path: 'x.ts' }, { path: 'y.ts' }],
    })
    expect(result.isError).toBe(true)
  })

  test('a single `path` still reads exactly as before — no batch sections', async () => {
    await writeFile(path.join(dir, 'one.txt'), 'only')
    const result = await createReadTool(undefined, dir).execute('s1', { path: 'one.txt' })
    expect(result.content).toBe('only')
    expect(result.details?.items).toBeUndefined()
  })

  test('neither `path` nor `reads` is a clear error', async () => {
    const result = await createReadTool(undefined, dir).execute('e1', {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('`reads`')
  })

  test('several images become several image parts, each named in the text', async () => {
    for (const name of ['a.png', 'b.png']) await writeFile(path.join(dir, name), PIXEL_PNG)
    const result = await createReadTool(undefined, dir).execute('i2', {
      reads: [{ path: 'a.png' }, { path: 'b.png' }],
    })
    expect(result.contentParts?.map((part) => part.type)).toEqual(['text', 'image', 'image'])
    expect(result.content).toContain('[image 1 of this call, below]')
    expect(result.content).toContain('[image 2 of this call, below]')
  })

  test('images past the per-call budget are named back to read separately', async () => {
    const names = Array.from({ length: MAX_BATCH_IMAGES + 1 }, (_, i) => `p${i}.png`)
    for (const name of names) await writeFile(path.join(dir, name), PIXEL_PNG)
    const result = await createReadTool(undefined, dir).execute('i3', {
      reads: names.map((name) => ({ path: name })),
    })
    const images = result.contentParts?.filter((part) => part.type === 'image') ?? []
    expect(images).toHaveLength(MAX_BATCH_IMAGES)
    expect(result.content).toContain('1 more not shown')
    expect(result.content).toContain(names.at(-1)!)
    expect(result.details?.items?.at(-1)?.skipped).toBe(true)
  })

  test('text past the batch budget is not delivered and leaves no mtime behind', async () => {
    // Each file is ~60 KB: two fit the 160 KB budget, the third does not.
    const big = 'x'.repeat(59_000)
    for (const name of ['1.txt', '2.txt', '3.txt']) await writeFile(path.join(dir, name), big)
    const mtimes = createFileMtimeStore()
    const tool = createReadTool(undefined, dir, undefined, undefined, mtimes)
    const result = await tool.execute('t1', {
      reads: [{ path: '1.txt' }, { path: '2.txt' }, { path: '3.txt' }],
    })

    expect(Buffer.byteLength(result.content)).toBeLessThan(MAX_BATCH_TEXT_BYTES + 1_000)
    expect(result.content).toContain('1 more not shown')
    expect(result.content).toContain('Read them separately: 3.txt')
    expect(mtimes.has(path.join(dir, '1.txt'))).toBe(true)
    expect(mtimes.has(path.join(dir, '3.txt'))).toBe(false)

    // The skipped file, read next, arrives in full.
    const again = await tool.execute('t2', { path: '3.txt' })
    expect(again.content.length).toBeGreaterThan(50_000)
  })

  test('more files than one call reads are named back', async () => {
    const names = Array.from({ length: MAX_READ_ITEMS + 2 }, (_, i) => `f${i}.txt`)
    for (const name of names) await writeFile(path.join(dir, name), name)
    const result = await createReadTool(undefined, dir).execute('n1', {
      reads: names.map((name) => ({ path: name })),
    })
    expect(result.details?.items?.filter((item) => !item.skipped)).toHaveLength(MAX_READ_ITEMS)
    expect(result.content).toContain('2 more not shown')
    expect(result.content).toContain(`${names.at(-2)}, ${names.at(-1)}`)
  })

  test('a repeated batch delivers every file in full, changed or not', async () => {
    await writeFile(path.join(dir, 'same.txt'), lines('same', 40))
    await writeFile(path.join(dir, 'moving.txt'), lines('v1', 40))
    const tool = createReadTool(undefined, dir)
    const reads = [{ path: 'same.txt' }, { path: 'moving.txt' }]
    await tool.execute('d1', { reads })
    await writeFile(path.join(dir, 'moving.txt'), lines('v2', 40))
    const second = await tool.execute('d2', { reads })

    const [same, moving] = second.content.split('\n\n### ')
    expect(same).toContain('same 40')
    expect(moving).toContain('v2 1')
  })

  test('each file records its mtime, so write may follow any of them', async () => {
    for (const name of ['a.txt', 'b.txt']) await writeFile(path.join(dir, name), name)
    const mtimes = createFileMtimeStore()
    const tool = createReadTool(undefined, dir, undefined, undefined, mtimes)
    await tool.execute('m1', { reads: [{ path: 'a.txt' }, { path: 'b.txt' }] })
    expect(mtimes.has(path.join(dir, 'a.txt'))).toBe(true)
    expect(mtimes.has(path.join(dir, 'b.txt'))).toBe(true)
  })

  test('parallel scope covers every file, so a same-file writer is serialized', () => {
    const tool = createReadTool(undefined, dir)
    expect(tool.parallelScopePaths?.({ path: 'a.ts', reads: [{ path: 'b.ts' }, 'c.ts'] })).toEqual(
      ['a.ts', 'b.ts', 'c.ts'].map((name) => path.join(dir, name)),
    )
  })
})

describe('readItems', () => {
  test('the top-level path keeps every field; entries inherit cwd/mode and bring their range', () => {
    const input = readToolInputSchema.parse({
      path: 'a.ts',
      offset: 10,
      mode: 'outline',
      cwd: 'src',
      reads: [{ path: 'b.ts', start_line: '3' }, 'c.ts'],
    })
    expect(readItems(input)).toEqual([
      { path: 'a.ts', offset: 10, mode: 'outline', cwd: 'src' },
      { path: 'b.ts', start_line: 3, mode: 'outline', cwd: 'src' },
      { path: 'c.ts', mode: 'outline', cwd: 'src' },
    ])
  })

  test('an entry repeated in one call is read once', () => {
    const input = readToolInputSchema.parse({ path: 'a.ts', reads: ['a.ts', { path: 'a.ts' }] })
    expect(readItems(input)).toEqual([{ path: 'a.ts' }])
  })

  test('a JSON-array string of paths is taken as that array', () => {
    const input = readToolInputSchema.parse({ reads: '["a.ts","b.ts"]' })
    expect(readItems(input).map((item) => item.path)).toEqual(['a.ts', 'b.ts'])
  })
})
