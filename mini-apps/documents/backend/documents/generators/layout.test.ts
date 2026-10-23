import { afterAll, beforeAll, afterEach, expect, test } from 'bun:test'
import {
  documentFontIds,
  documentLayoutSchema,
  type DocumentFont,
} from '@localixai/mini-app-sdk/document-layout'
import { createDocumentGenerator } from './generator'
import { createPdfConverter } from '../drivers/pdf'
import { unzipSync, strFromU8 } from 'fflate'

const keys = ['DOMMatrix', 'ImageData', 'Path2D', '_pdfjsTestingUtils', 'pdfjsLib', 'pdfjsWorker']
const prior = new Map<string, PropertyDescriptor | undefined>()
beforeAll(() =>
  keys.forEach((key) => prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))),
)
afterAll(() =>
  keys.forEach((key) => {
    const descriptor = prior.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }),
)
afterEach(() => {
  delete (globalThis as { buffer?: unknown }).buffer
  delete (globalThis as { callback?: unknown }).callback
})
const makeLayout = (font: DocumentFont = 'inter') =>
  documentLayoutSchema.parse({
    title: 'Unicode resume',
    blocks: [
      {
        kind: 'paragraph',
        font,
        size: 22,
        keepWithNext: true,
        runs: [
          {
            text: '\u0410\u043b\u0435\u043a\u0441\u0435\u0439 \u0418\u0432\u0430\u043d\u043e\u0432',
            bold: true,
          },
        ],
      },
      {
        kind: 'paragraph',
        font,
        size: 9,
        runs: [
          {
            text: '\u041c\u043e\u0441\u043a\u0432\u0430, \u0420\u043e\u0441\u0441\u0438\u044f. Node.js — \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a.',
          },
        ],
      },
    ],
  })
test('every selectable font retains Cyrillic in actual PDF extraction', async () => {
  const generator = createDocumentGenerator()
  const converter = createPdfConverter()
  for (const font of documentFontIds) {
    const output = await generator.generate({
      format: 'pdf',
      content: 'Resume',
      layout: makeLayout(font),
    })
    const extracted = await converter.extract({
      bytes: Buffer.from(output.bytes),
      format: 'pdf',
      mediaType: 'application/pdf',
    })
    if (extracted.kind !== 'text') throw new Error('PDF extraction must produce text')
    expect(extracted.markdown).toContain(
      '\u0410\u043b\u0435\u043a\u0441\u0435\u0439 \u0418\u0432\u0430\u043d\u043e\u0432',
    )
    expect(extracted.markdown.replace(/\s+,/gu, ',')).toContain(
      '\u041c\u043e\u0441\u043a\u0432\u0430, \u0420\u043e\u0441\u0441\u0438\u044f',
    )
  }
}, 15_000)
test('ordinary Markdown PDF generation also keeps Cyrillic and mixed styling', async () => {
  const output = await createDocumentGenerator().generate({
    format: 'pdf',
    content:
      '# \u0410\u043b\u0435\u043a\u0441\u0435\u0439 \u0418\u0432\u0430\u043d\u043e\u0432\n\n\u041c\u043e\u0441\u043a\u0432\u0430, **\u0420\u043e\u0441\u0441\u0438\u044f** \u0438 *\u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430*.',
  })
  const extracted = await createPdfConverter().extract({
    bytes: Buffer.from(output.bytes),
    format: 'pdf',
    mediaType: 'application/pdf',
  })
  if (extracted.kind !== 'text') throw new Error('PDF extraction must produce text')
  expect(extracted.markdown).toContain(
    '\u0410\u043b\u0435\u043a\u0441\u0435\u0439 \u0418\u0432\u0430\u043d\u043e\u0432',
  )
  expect(extracted.markdown).toContain('\u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430')
})
test('Word carries typography, selectable Unicode and embedded font bytes', async () => {
  const output = await createDocumentGenerator().generate({
    format: 'docx',
    content: 'Resume',
    layout: makeLayout('lora'),
  })
  const files = unzipSync(output.bytes)
  const xml = strFromU8(files['word/document.xml']!)
  expect(xml).toContain(
    '\u0410\u043b\u0435\u043a\u0441\u0435\u0439 \u0418\u0432\u0430\u043d\u043e\u0432',
  )
  expect(xml).toContain('w:sz w:val="44"')
  expect(xml).toContain('Lora')
  expect(Object.keys(files).some((name) => name.endsWith('.odttf'))).toBe(true)
})
test('layout guards reject unsafe links and out-of-range page geometry', () => {
  const layout = makeLayout()
  expect(documentLayoutSchema.safeParse({ ...layout, margin: -1 }).success).toBe(false)
  const unsafe = structuredClone(layout)
  if (unsafe.blocks[0].kind === 'paragraph') unsafe.blocks[0].runs[0].href = 'javascript:alert(1)'
  expect(documentLayoutSchema.safeParse(unsafe).success).toBe(false)
})
