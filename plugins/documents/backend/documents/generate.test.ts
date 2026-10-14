import { afterEach, describe, expect, test } from 'bun:test'
import * as XLSX from 'xlsx'
import { createDocumentStore } from './store'
import { createDocumentsService } from './service'
import { DocumentError } from './errors'

/** A .docx / .xlsx is an OOXML zip — first two bytes are the ZIP local-file magic `PK`. */
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}
/** A PDF starts with the `%PDF-` signature. */
function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.slice(0, 5)).toString('latin1') === '%PDF-'
}

// The generator does no IO; a store is only needed to satisfy the service factory.
function makeService() {
  return createDocumentsService({ store: createDocumentStore({ dir: '/tmp/localix-gen-unused' }) })
}

const MD = [
  '# Quarterly Report',
  '',
  'This has **bold**, *italic*, and `code` text.',
  '',
  '- first item',
  '- second item',
  '',
  '1. step one',
  '2. step two',
  '',
  '| Name | Score |',
  '| --- | --- |',
  '| Ann | 30 |',
  '| Bob | 25 |',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '> a quoted note',
].join('\n')

describe('documents generate — docx', () => {
  test('Markdown → a valid, non-empty .docx zip', async () => {
    const svc = makeService()
    const out = await svc.generate({ format: 'docx', content: MD })
    expect(out.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(out.bytes.byteLength).toBeGreaterThan(500)
    expect(isZip(out.bytes)).toBe(true)
  })

  test('derives the filename from the first heading', async () => {
    const svc = makeService()
    const out = await svc.generate({ format: 'docx', content: MD })
    expect(out.suggestedFilename).toBe('quarterly-report.docx')
  })

  test('honours an explicit filename hint (extension normalised)', async () => {
    const svc = makeService()
    const out = await svc.generate({ format: 'docx', content: '# X', filename: 'My Report.pdf' })
    expect(out.suggestedFilename).toBe('my-report.docx')
  })
})

describe('documents generate — pdf', () => {
  afterEach(() => {
    // The PDF serializer leaves these scratch globals behind in Bun.
    delete (globalThis as { buffer?: unknown }).buffer
    delete (globalThis as { callback?: unknown }).callback
  })

  test('Markdown → a valid, non-empty PDF', async () => {
    const svc = makeService()
    const out = await svc.generate({ format: 'pdf', content: MD })
    expect(out.mediaType).toBe('application/pdf')
    expect(out.bytes.byteLength).toBeGreaterThan(500)
    expect(isPdf(out.bytes)).toBe(true)
    expect(out.suggestedFilename).toBe('quarterly-report.pdf')
  })
})

describe('documents generate — xlsx', () => {
  test('a Markdown pipe table → a valid .xlsx that round-trips through SheetJS', async () => {
    const svc = makeService()
    const table = '| Name | Score |\n| --- | --- |\n| Ann | 30 |\n| Bob | 25 |'
    const out = await svc.generate({ format: 'xlsx', content: table })
    expect(out.mediaType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(isZip(out.bytes)).toBe(true)

    const wb = XLSX.read(out.bytes, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
    expect(rows).toHaveLength(2)
    expect(rows[0].Name).toBe('Ann')
  })

  test('a JSON array-of-objects → a valid .xlsx', async () => {
    const svc = makeService()
    const json = JSON.stringify([
      { city: 'Paris', pop: 2 },
      { city: 'Lyon', pop: 1 },
    ])
    const out = await svc.generate({ format: 'xlsx', content: json })
    expect(isZip(out.bytes)).toBe(true)
    const wb = XLSX.read(out.bytes, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])
    expect(rows).toHaveLength(2)
    expect(rows[1].city).toBe('Lyon')
  })

  test('non-tabular xlsx content fails with a typed generate_failed', async () => {
    const svc = makeService()
    expect(
      svc.generate({ format: 'xlsx', content: 'just prose, no table' }),
    ).rejects.toBeInstanceOf(DocumentError)
    try {
      await svc.generate({ format: 'xlsx', content: 'just prose, no table' })
    } catch (err) {
      expect((err as DocumentError).code).toBe('generate_failed')
    }
  })

  test('a {sheets:[…]} workbook → one tab per sheet, values intact', async () => {
    const svc = makeService()
    const json = JSON.stringify({
      sheets: [
        {
          name: 'Revenue',
          columns: ['Region', 'Total'],
          rows: [
            ['EU', 10],
            ['US', 20],
          ],
        },
        // Bare rows (array-of-objects) — the same single-table shape, wrapped per tab.
        {
          name: 'People',
          rows: [
            { name: 'Ann', age: 30 },
            { name: 'Bob', age: 25 },
          ],
        },
      ],
    })
    const out = await svc.generate({ format: 'xlsx', content: json })
    expect(isZip(out.bytes)).toBe(true)
    const wb = XLSX.read(out.bytes, { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['Revenue', 'People'])
    const revenue = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Revenue)
    expect(revenue).toHaveLength(2)
    expect(revenue[1].Total).toBe(20)
    const people = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.People)
    expect(people[0].name).toBe('Ann')
  })

  test('workbook sheet names are repaired, deduped, and defaulted — never rejected', async () => {
    const svc = makeService()
    const json = JSON.stringify({
      sheets: [
        // Illegal chars + over-length → sanitized and clipped to 31.
        { name: 'Q1: [draft]/*final?*', rows: [['a'], ['b']] },
        // Case-insensitive collision with the repaired name above → "(2)" suffix.
        { name: 'q1  draft final', rows: [['c'], ['d']] },
        // Missing name → positional default.
        { rows: [['e'], ['f']] },
      ],
    })
    const out = await svc.generate({ format: 'xlsx', content: json })
    const wb = XLSX.read(out.bytes, { type: 'buffer' })
    expect(wb.SheetNames).toHaveLength(3)
    for (const name of wb.SheetNames) {
      expect(name.length).toBeLessThanOrEqual(31)
      expect(/[[\]:*?/\\]/.test(name)).toBe(false)
    }
    expect(new Set(wb.SheetNames.map((n) => n.toLowerCase())).size).toBe(3)
    expect(wb.SheetNames[2]).toBe('Sheet3')
  })

  test('an empty sheets array fails with a typed generate_failed', async () => {
    const svc = makeService()
    try {
      await svc.generate({ format: 'xlsx', content: '{"sheets": []}' })
      expect.unreachable('empty workbook must be rejected')
    } catch (err) {
      expect((err as DocumentError).code).toBe('generate_failed')
    }
  })
})
