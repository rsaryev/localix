import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TableColumn, TableRow } from '@localixai/dataview'
import { createTableStore } from './store'
import { createTableService, exportBaseName } from './service'

const dir = await mkdtemp(path.join(tmpdir(), 'localix-table-test-'))
const store = createTableStore({ dir })
const service = createTableService(store)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const columns: TableColumn[] = [
  { id: 'name', title: 'Name', type: 'text' },
  { id: 'score', title: 'Score', type: 'int' },
]
const rows: TableRow[] = [
  { name: 'Charlie', score: 30 },
  { name: 'Alice', score: 10 },
  { name: 'Bob', score: 20 },
  { name: 'Dana, Jr.', score: 40 }, // comma → exercises CSV quoting
]

async function seed(userId = 'u1') {
  return store.save({
    userId,
    sessionId: 's1',
    title: 'Players',
    columns,
    rows,
    view: 'table',
    source: { kind: 'inline' },
  })
}

describe('table store', () => {
  test('save → get returns the record', async () => {
    const rec = await seed()
    const got = await store.get('u1', rec.id)
    expect(got?.rowCount).toBe(4)
    expect(got?.title).toBe('Players')
  })

  test('ownership gate: another user cannot read', async () => {
    const rec = await seed('owner')
    expect(await store.get('intruder', rec.id)).toBeNull()
    expect(await service.page('intruder', rec.id, {})).toBeNull()
  })

  test('rejects malformed ids without touching disk', async () => {
    expect(await store.get('u1', '../etc/passwd')).toBeNull()
  })

  test('meta cache is bounded — evicting past the cap still serves from disk', async () => {
    // rowCacheCap:1 → metaCap = 1*8 = 8. Save well past that so the earliest
    // metas are FIFO-evicted, then prove the store still returns them (a bounded
    // cache is behavior-preserving: an eviction is a plain re-read from disk).
    const capped = createTableStore({ dir, rowCacheCap: 1 })
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const rec = await capped.save({
        userId: 'cap',
        sessionId: 's1',
        title: `T${i}`,
        columns,
        rows,
        view: 'table',
        source: { kind: 'inline' },
      })
      ids.push(rec.id)
    }
    // The first id was long since evicted from the in-memory meta cache, yet a
    // read still succeeds (served from meta.json) with the right data.
    const first = await capped.get('cap', ids[0])
    expect(first?.title).toBe('T0')
    const firstRows = await capped.getRows('cap', ids[0])
    expect(firstRows?.rows.length).toBe(4)
  })
})

describe('table service: page (sort / filter / paginate)', () => {
  test('sort ascending by numeric column', async () => {
    const rec = await seed()
    const page = await service.page('u1', rec.id, { sort: { columnId: 'score', dir: 'asc' } })
    expect(page?.rows.map((r) => r.score)).toEqual([10, 20, 30, 40])
    expect(page?.total).toBe(4)
  })

  test('sort descending', async () => {
    const rec = await seed()
    const page = await service.page('u1', rec.id, { sort: { columnId: 'score', dir: 'desc' } })
    expect(page?.rows.map((r) => r.score)).toEqual([40, 30, 20, 10])
  })

  test('free-text filter narrows total', async () => {
    const rec = await seed()
    const page = await service.page('u1', rec.id, { filter: { query: 'ali' } })
    expect(page?.total).toBe(1)
    expect(page?.rows[0]?.name).toBe('Alice')
  })

  test('column-scoped filter', async () => {
    const rec = await seed()
    const page = await service.page('u1', rec.id, { filter: { columnId: 'name', query: 'b' } })
    expect(page?.rows.map((r) => r.name).sort()).toEqual(['Bob'])
  })

  test('offset + limit window with full total', async () => {
    const rec = await seed()
    const page = await service.page('u1', rec.id, {
      sort: { columnId: 'score', dir: 'asc' },
      offset: 1,
      limit: 2,
    })
    expect(page?.rows.map((r) => r.score)).toEqual([20, 30])
    expect(page?.total).toBe(4)
    expect(page?.offset).toBe(1)
  })
})

describe('table service: export', () => {
  test('CSV export carries mime, filename, RFC-4180 quoting', async () => {
    const rec = await seed()
    const res = await service.exportTable('u1', rec.id, 'csv')
    expect(res?.mimeType).toContain('csv')
    expect(res?.filename).toBe('Players.csv')
    const body = String(res?.body)
    expect(body.split(/\r?\n/)[0]).toBe('Name,Score') // RFC-4180 uses CRLF
    expect(body).toContain('"Dana, Jr.",40') // comma value is quoted
  })

  test('unknown format falls back to CSV', async () => {
    const rec = await seed()
    const res = await service.exportTable('u1', rec.id, 'nonsense')
    expect(res?.filename).toBe('Players.csv')
  })

  test('XLSX export produces real workbook bytes (SheetJS round-trip)', async () => {
    const rec = await seed()
    const res = await service.exportTable('u1', rec.id, 'xlsx')
    expect(res?.filename).toBe('Players.xlsx')
    expect(res?.mimeType).toContain('spreadsheetml.sheet')
    const bytes = res?.body as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    // .xlsx is a ZIP container — starts with the PK magic bytes.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    // Round-trip: SheetJS reads it back to the same header + typed cells.
    const XLSX = (await import('xlsx')) as unknown as {
      read: (
        d: Uint8Array,
        o?: Record<string, unknown>,
      ) => { SheetNames: string[]; Sheets: Record<string, unknown> }
      utils: { sheet_to_json: <T>(s: unknown, o?: Record<string, unknown>) => T[] }
    }
    const wb = XLSX.read(bytes, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]!]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
    expect(matrix[0]).toEqual(['Name', 'Score'])
    // Numbers survive as numbers, not strings.
    expect(matrix[1]).toEqual(['Charlie', 30])
  })

  test('export respects ownership', async () => {
    const rec = await seed('owner')
    expect(await service.exportTable('intruder', rec.id, 'csv')).toBeNull()
  })
})

describe('table service: ingest (open-as-table)', () => {
  const ingestService = createTableService(store, {
    ingestPort: {
      // A `.bin` path stands in for a non-tabular file; everything else (incl. a
      // media-id source, which carries no path) "extracts".
      extractTable: async ({ path: p }) => (p?.endsWith('.bin') ? null : { columns, rows }),
    },
  })

  test('ingests a file into a persisted table and returns its meta', async () => {
    const res = await ingestService.ingest('u1', 's1', { path: '/tmp/data.csv' })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.rowCount).toBe(4)
    expect(res.title).toBe('data.csv') // basename of the source path
    // The saved record is retrievable + pageable by its returned id.
    const page = await ingestService.page('u1', res.id, {})
    expect(page?.total).toBe(4)
  })

  test('ingests a stored file by media id, titled by its original name', async () => {
    const res = await ingestService.ingest('u1', 's1', {
      mediaId: 'abc.csv',
      name: 'quarterly.csv',
    })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.rowCount).toBe(4)
    expect(res.title).toBe('quarterly.csv') // from `name`, since a media id has no path
  })

  test('non-tabular file → not_tabular', async () => {
    expect(await ingestService.ingest('u1', 's1', { path: '/tmp/img.bin' })).toEqual({
      error: 'not_tabular',
    })
  })

  test('no ingest port configured → ingest_unavailable', async () => {
    // `service` (top of file) was built without an ingest port.
    expect(await service.ingest('u1', 's1', { path: '/tmp/data.csv' })).toEqual({
      error: 'ingest_unavailable',
    })
  })
})

describe('table service: open targets', () => {
  test('always offers system-default + reveal on a supported platform', () => {
    const targets = service.openTargets()
    // CI may run on linux/darwin/win — all three include these two.
    const ids = targets.map((t) => t.id)
    if (
      process.platform === 'darwin' ||
      process.platform === 'win32' ||
      process.platform === 'linux'
    ) {
      expect(ids).toContain('system-default')
      expect(ids).toContain('reveal')
    }
  })

  test('open rejects an unknown target without spawning', async () => {
    const rec = await seed()
    const res = await service.open('u1', rec.id, 'no-such-target')
    expect(res).toEqual({ error: 'target_unavailable' })
  })

  test('open rejects a missing table', async () => {
    const res = await service.open('u1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'system-default')
    expect('error' in res).toBe(true)
  })
})

/**
 * exportBaseName is a documented NON-MEMBER of the safe-file-key class (see the allow-list entry
 * in `features/ext/safe-file-key-contract.test.ts`): it slugs a display TITLE, not a key, and it
 * is free to be lossy because identity is supplied by the `-${id.slice(0,8)}` the caller appends.
 *
 * But "the guard blesses this exception" is a CLAIM, and an unenforced claim is how the fifth
 * copy of the rule (`memory/file-store.ts`) came to admit `.` and traverse. So the properties the
 * allow-list asserts are pinned HERE. Widen the charset, drop the `|| 'table'` fallback, or stop
 * appending the id, and one of these goes red.
 */
describe('exportBaseName — the non-member contract, enforced', () => {
  /** Exactly how `openIn` uses it: a scratch-dir filename with the record id appended. */
  const DIR = '/scratch/table-exports'
  const fileFor = (title: string) => path.join(DIR, `${exportBaseName({ title })}-abcd1234.csv`)

  const hostile = [
    ['bare dot-dot', '..'],
    ['single dot', '.'],
    ['relative traversal', '../../etc/passwd'],
    ['absolute path', '/etc/passwd'],
    ['windows separators', '..\\..\\secrets'],
    ['NUL byte', 'x\0/../../etc'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['home expansion', '~/.ssh/id_rsa'],
    ['header injection', 'a"\r\nSet-Cookie: x=1'],
    ['very long', 'a'.repeat(500)],
  ] as const

  for (const [name, title] of hostile) {
    test(name, () => {
      const base = exportBaseName({ title })

      // 1. One path SEGMENT, and never a dot-segment or empty — so it cannot steer a path.join.
      expect(base).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(base.length).toBeGreaterThan(0)
      expect(base).not.toBe('.')
      expect(base).not.toBe('..')

      // 2. Contained, through the REAL path.join on Bun — not by reasoning about it.
      const file = fileFor(title)
      expect(path.dirname(file)).toBe(DIR)
      expect(path.relative(DIR, file).startsWith('..')).toBe(false)

      // 3. Safe as a `Content-Disposition: attachment; filename="…"` value: it can neither close
      //    the quote nor inject a header line. (That is the OTHER sink — `exportTable`.)
      expect(base).not.toContain('"')
      expect(base).not.toContain('\r')
      expect(base).not.toContain('\n')
    })
  }

  test('it is LOSSY on purpose — identity comes from the appended id, not from this name', () => {
    // Two different titles legitimately slug to one base. That is fine here, and would NOT be
    // fine in a file KEY — which is the whole reason this is not one.
    expect(exportBaseName({ title: 'Q3 Revenue' })).toBe(exportBaseName({ title: 'Q3/Revenue' }))
    // …because the caller appends the id, so the two records still get different files.
    expect(path.join(DIR, `${exportBaseName({ title: 'Q3 Revenue' })}-11111111.csv`)).not.toBe(
      path.join(DIR, `${exportBaseName({ title: 'Q3/Revenue' })}-22222222.csv`),
    )
  })

  test('it TRUNCATES — the property that disqualifies it as a file key', () => {
    // A file key must never silently truncate two long keys into one file. This may, because the
    // id behind it keeps them apart. Pinned so the distinction cannot be quietly erased.
    expect(exportBaseName({ title: 'a'.repeat(500) })).toHaveLength(64)
  })

  test('a readable title survives readably (it is a DISPLAY name)', () => {
    expect(exportBaseName({ title: 'Q3 — Revenue (final)' })).toBe('Q3_Revenue_final')
    expect(exportBaseName({ title: undefined })).toBe('table')
  })
})
