import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import type { DocExtractWindow } from '@localixai/mini-app-sdk/backend'
import { createReadTool } from './read'
import { parsePageRange } from './read-document'
import { sniffImage } from './read-image-sniff'

/** A 1×1 PNG. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** A valid grayscale PNG of the given size — big enough to trigger the downscale. */
function grayPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  const raw = Buffer.alloc((width + 1) * height, 0x80)
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0 // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let tempDir = ''
beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-read-media-'))
})
afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('read on an image', () => {
  test('a PNG comes back as an image part, led by a text part the model also receives', async () => {
    await writeFile(path.join(tempDir, 'pixel.png'), PIXEL_PNG)
    const result = await createReadTool(undefined, tempDir).execute('i1', { path: 'pixel.png' })

    expect(result.isError).toBeUndefined()
    expect(result.contentParts?.map((part) => part.type)).toEqual(['text', 'image'])
    expect(result.contentParts?.[1]).toMatchObject({ type: 'image', mediaType: 'image/png' })
    expect(result.content).toContain('1×1')
    expect(result.details).toMatchObject({ kind: 'image', mediaType: 'image/png', width: 1 })
    expect(result.details?.bytes).toBe(PIXEL_PNG.byteLength)
  })

  test('a misnamed image is recognised by its bytes, not its name', async () => {
    await writeFile(path.join(tempDir, 'screenshot.bin'), PIXEL_PNG)
    await writeFile(path.join(tempDir, 'actually.jpg'), PIXEL_PNG)
    const tool = createReadTool(undefined, tempDir)

    const bin = await tool.execute('i2', { path: 'screenshot.bin' })
    expect(bin.contentParts?.[1]).toMatchObject({ type: 'image', mediaType: 'image/png' })
    // The extension says JPEG; the signature wins, so the provider is not told a lie.
    const jpg = await tool.execute('i3', { path: 'actually.jpg' })
    expect(jpg.contentParts?.[1]).toMatchObject({ type: 'image', mediaType: 'image/png' })
  })

  test('a text file named .png is read as text', async () => {
    await writeFile(path.join(tempDir, 'notes.png'), 'just words\n')
    const result = await createReadTool(undefined, tempDir).execute('i4', { path: 'notes.png' })
    expect(result.contentParts).toBeUndefined()
    expect(result.content).toContain('just words')
  })

  test('a large image is downscaled and the model is told the original and new size', async () => {
    await writeFile(path.join(tempDir, 'wide.png'), grayPng(2000, 20))
    const result = await createReadTool(undefined, tempDir).execute('i5', { path: 'wide.png' })

    expect(result.content).toContain('resized from 2000×20 to 1568×16')
    const image = result.contentParts?.[1]
    expect(image?.type).toBe('image')
    const sent = sniffImage(Buffer.from(image?.type === 'image' ? image.data : '', 'base64'))
    expect(sent).toMatchObject({ width: 1568, height: 16 })
  })

  test('a text-only model keeps read and gets the facts in text instead of pixels', async () => {
    await writeFile(path.join(tempDir, 'pixel.png'), PIXEL_PNG)
    const tool = createReadTool(undefined, tempDir).forModel!(['text'])
    const result = await tool.execute('i6', { path: 'pixel.png' })

    expect(result.contentParts).toBeUndefined()
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('cannot view images')
    expect(result.content).toContain('PNG, 1×1')
  })
})

describe('read on a notebook', () => {
  const notebook = {
    nbformat: 4,
    metadata: { kernelspec: { language: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Title\n', 'Some prose'] },
      {
        cell_type: 'code',
        execution_count: 2,
        source: 'print("hi")\nplot()',
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['hi\n'] },
          {
            output_type: 'display_data',
            data: { 'image/png': PIXEL_PNG.toString('base64'), 'text/plain': '<Figure>' },
          },
          { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['\u001b[31mx'] },
        ],
      },
    ],
  }

  test('renders cells with their sources and text outputs, naming the rest', async () => {
    await writeFile(path.join(tempDir, 'nb.ipynb'), JSON.stringify(notebook))
    const result = await createReadTool(undefined, tempDir).forModel!(['text']).execute('n1', {
      path: 'nb.ipynb',
    })

    expect(result.content).toContain('[Jupyter notebook · 2 cells · python]')
    expect(result.content).toContain('## Cell 0 [markdown]')
    expect(result.content).toContain('## Cell 1 [code · run 2]')
    expect(result.content).toContain('```python\nprint("hi")')
    expect(result.content).toContain('[stdout]\nhi')
    expect(result.content).toContain('<Figure>')
    expect(result.content).toContain('[image/png output not shown]')
    expect(result.content).toContain('[error] ValueError: bad')
    expect(result.content).not.toContain('\u001b[')
    expect(result.content).not.toContain(PIXEL_PNG.toString('base64'))
    expect(result.contentParts).toBeUndefined()
  })

  test('a model that sees images gets the plot outputs as image parts', async () => {
    await writeFile(path.join(tempDir, 'nb.ipynb'), JSON.stringify(notebook))
    const result = await createReadTool(undefined, tempDir).execute('n2', { path: 'nb.ipynb' })
    expect(result.content).toContain('[image/png output: attached as image 1]')
    expect(result.contentParts?.map((part) => part.type)).toEqual(['text', 'image'])
  })

  test('a line range still reads the raw JSON, which is what edit changes', async () => {
    await writeFile(path.join(tempDir, 'nb.ipynb'), JSON.stringify(notebook, null, 1))
    const result = await createReadTool(undefined, tempDir).execute('n3', {
      path: 'nb.ipynb',
      start_line: 1,
      end_line: 3,
    })
    expect(result.content).toContain('"nbformat": 4')
    expect(result.content).not.toContain('Jupyter notebook')
  })
})

describe('read on a document', () => {
  const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])

  test('pages and sheet narrow the extraction itself', async () => {
    await writeFile(path.join(tempDir, 'deck.pdf'), binary)
    await writeFile(path.join(tempDir, 'book.xls'), binary)
    const seen: Array<DocExtractWindow | undefined> = []
    const extractor = async (_p: string, _o?: number, window?: DocExtractWindow) => {
      seen.push(window)
      return 'extracted'
    }
    const tool = createReadTool(undefined, tempDir, undefined, extractor)

    expect((await tool.execute('d1', { path: 'deck.pdf', pages: '1-5' })).content).toBe('extracted')
    await tool.execute('d2', { path: 'book.xls', sheet: 'Q3' })
    expect(seen).toEqual([{ pageRange: { start: 1, end: 5 } }, { sheet: 'Q3' }])

    const bad = await tool.execute('d3', { path: 'deck.pdf', pages: '5-1' })
    expect(bad.isError).toBe(true)
    expect(bad.content).toContain('Invalid pages')
  })

  test('without a document extractor the model is told why, not handed a binary notice', async () => {
    await writeFile(path.join(tempDir, 'report.docx'), binary)
    const result = await createReadTool(undefined, tempDir).execute('d4', { path: 'report.docx' })
    expect(result.content).toContain('document extraction is unavailable')
  })

  test('page ranges parse the forms the schema advertises', () => {
    expect(parsePageRange('3')).toEqual({ start: 3, end: 3 })
    expect(parsePageRange('1-5')).toEqual({ start: 1, end: 5 })
    expect(parsePageRange('10-')).toEqual({ start: 10 })
    expect(typeof parsePageRange('0')).toBe('string')
    expect(typeof parsePageRange('a-b')).toBe('string')
  })
})
