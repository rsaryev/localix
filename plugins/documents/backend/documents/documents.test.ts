import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import * as XLSX from 'xlsx'

import { createDocxConverter } from './drivers/docx'
import { createXlsxConverter } from './drivers/xlsx'
import { createCsvConverter } from './drivers/csv'
import { createDocumentStore, hashDocumentInput } from './store'
import { createDocumentsService } from './service'
import { detectFormat } from './registry'
import type { DocumentConverter, ExtractedTextDocument } from './contracts'

const tmpRoots: string[] = []
async function freshStoreDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'localix-docs-test-'))
  tmpRoots.push(dir)
  return join(dir, 'documents')
}
afterAll(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true })
})

// --- Fixtures -------------------------------------------------------------

/** Build a minimal, valid .docx (an OOXML zip) with a paragraph + a 2x2 table. */
function makeDocx(): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`
  const rowXml = (a: string, b: string, header = false) =>
    `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cell(a)}${cell(b)}</w:tr>`
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello Localix documents</w:t></w:r></w:p>
    <w:tbl>${rowXml('Name', 'Role', true)}${rowXml('Ada', 'Engineer')}</w:tbl>
  </w:body>
</w:document>`
  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(document),
  })
  return Buffer.from(zipped)
}

/** Build a tiny .xlsx via SheetJS itself (round-trip write → read through the driver). */
function makeXlsx(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['name', 'age', 'active'],
    ['Ada', 36, true],
    ['Linus', 54, false],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'People')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// --- Drivers --------------------------------------------------------------

describe('docx driver', () => {
  test('extracts a Word document to Markdown with a GFM table', async () => {
    const doc = await createDocxConverter().extract({ bytes: makeDocx(), format: 'docx' })
    expect(doc.kind).toBe('text')
    if (doc.kind !== 'text') throw new Error('expected text')
    expect(doc.markdown).toContain('Hello Localix documents')
    // Table survives as a GFM pipe table.
    expect(doc.markdown).toContain('Name')
    expect(doc.markdown).toContain('Role')
    expect(doc.markdown).toContain('Ada')
    expect(doc.markdown).toContain('Engineer')
    expect(doc.markdown).toContain('|')
    expect(doc.metadata.format).toBe('docx')
  })
})

describe('xlsx driver', () => {
  test('extracts a spreadsheet to dataview rows + typed columns', async () => {
    const doc = await createXlsxConverter().extract({ bytes: makeXlsx(), format: 'xlsx' })
    expect(doc.kind).toBe('table')
    if (doc.kind !== 'table') throw new Error('expected table')
    expect(doc.columns.map((c) => c.title)).toEqual(['name', 'age', 'active'])
    // Numeric + boolean columns are inferred, not left as text.
    const byTitle = Object.fromEntries(doc.columns.map((c) => [c.title, c.type]))
    expect(byTitle.age).toBe('int')
    expect(byTitle.active).toBe('bool')
    expect(doc.rows.length).toBe(2)
    const ada = doc.rows.find((r) => r.name === 'Ada')
    expect(ada?.age).toBe(36)
    expect(ada?.active).toBe(true)
    expect(doc.metadata.format).toBe('xlsx')
    expect(doc.metadata.sheetNames).toEqual(['People'])
  })
})

describe('csv driver', () => {
  test('extracts delimited text to a table', async () => {
    const bytes = Buffer.from('a,b\n1,2\n3,4\n', 'utf8')
    const doc = await createCsvConverter().extract({ bytes, format: 'csv' })
    expect(doc.kind).toBe('table')
    if (doc.kind !== 'table') throw new Error('expected table')
    expect(doc.columns.map((c) => c.title)).toEqual(['a', 'b'])
    expect(doc.rows.length).toBe(2)
  })
})

// --- Store (content-addressed cache dedup) --------------------------------

describe('document store', () => {
  // Annotated as the TEXT variant, which is what it builds. Typing it as the whole
  // ExtractedDocument union made `{ ...sampleDoc(), markdown: … }` below unsound —
  // the table variant has no `markdown` field at all.
  const sampleDoc = (): ExtractedTextDocument => ({
    kind: 'text',
    markdown: '# Title\n\nbody',
    metadata: { format: 'md' },
  })

  test('put → get round-trips the extracted document', async () => {
    const store = createDocumentStore({ dir: await freshStoreDir() })
    const hash = hashDocumentInput(Buffer.from('source-a'))
    const { id } = await store.put(hash, sampleDoc())
    expect(id).toBe(`${hash}.json`)
    const got = await store.get(id)
    expect(got).toEqual(sampleDoc())
    expect(await store.getByHash(hash)).toEqual(sampleDoc())
  })

  test('content-addressed: identical hash de-dupes to ONE cache file', async () => {
    const dir = await freshStoreDir()
    const store = createDocumentStore({ dir })
    const hash = hashDocumentInput(Buffer.from('same-bytes'))
    const a = await store.put(hash, sampleDoc())
    const b = await store.put(hash, { ...sampleDoc(), markdown: 'different but same key' })
    expect(a.id).toBe(b.id)
    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1)
    // First write wins (idempotent skip on an existing hash).
    expect(await store.get(a.id)).toEqual(sampleDoc())
  })

  test('different content → different ids', async () => {
    const store = createDocumentStore({ dir: await freshStoreDir() })
    const a = await store.put(hashDocumentInput(Buffer.from('one')), sampleDoc())
    const b = await store.put(hashDocumentInput(Buffer.from('two')), sampleDoc())
    expect(a.id).not.toBe(b.id)
  })

  test('rejects malformed / traversal ids', async () => {
    const store = createDocumentStore({ dir: await freshStoreDir() })
    expect(await store.get('../../etc/passwd')).toBeNull()
    expect(await store.get('abc.json')).toBeNull()
    expect(await store.get(`${'a'.repeat(64)}.txt`)).toBeNull()
  })
})

// --- Service (detect + cache + window) ------------------------------------

describe('documents service', () => {
  test('caches the heavy extraction: converter runs once for two identical extracts', async () => {
    let calls = 0
    const spyConverter: DocumentConverter = {
      async extract(input) {
        calls++
        return {
          kind: 'text',
          markdown: input.bytes.toString('utf8'),
          metadata: { format: input.format },
        }
      },
    }
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
      converterFor: () => spyConverter,
      readPath: async () => Buffer.from('some markdown body'),
    })
    const first = await service.extract({ path: '/x/doc.md' })
    const second = await service.extract({ path: '/x/doc.md' })
    expect(first.id).toBe(second.id)
    expect(calls).toBe(1) // second call was a cache hit
    if (first.document.kind !== 'text') throw new Error('expected text')
    expect(first.document.markdown).toBe('some markdown body')
  })

  test('windows a text extraction by offset/limit and flags truncation', async () => {
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
      converterFor: () => ({
        async extract(input) {
          return { kind: 'text', markdown: 'ABCDEFGHIJ', metadata: { format: input.format } }
        },
      }),
      readPath: async () => Buffer.from('ignored'),
    })
    const res = await service.extract({ path: '/x/doc.md', options: { offset: 2, limit: 3 } })
    if (res.document.kind !== 'text') throw new Error('expected text')
    expect(res.document.markdown).toBe('CDE')
    expect(res.document.metadata.truncated).toBe(true)
  })

  test('unknown format → unsupported_format', async () => {
    const service = createDocumentsService({
      store: createDocumentStore({ dir: await freshStoreDir() }),
      readPath: async () => Buffer.from('data'),
    })
    expect(service.extract({ path: '/x/mystery.bin' })).rejects.toThrow(/format/i)
  })
})

describe('format detection', () => {
  test('detects by extension and media type', () => {
    expect(detectFormat({ path: '/a/report.docx' })).toBe('docx')
    expect(detectFormat({ path: '/a/data.xlsx' })).toBe('xlsx')
    expect(detectFormat({ path: '/a/notes.md' })).toBe('md')
    expect(detectFormat({ mediaType: 'application/pdf' })).toBe('pdf')
    expect(
      detectFormat({
        mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toBe('pptx')
    expect(detectFormat({ path: '/a/weird.bin' })).toBeUndefined()
  })
})
