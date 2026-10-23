import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_TABLE_ROWS } from './documents/service'
import { getDocumentsServices } from './singleton'

let dir: string | undefined
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('open-as-table ingest', () => {
  test('a sheet larger than the extraction window is ingested whole', async () => {
    // `extract` answers with a model-sized window; ingesting that window kept only the first
    // MAX_TABLE_ROWS rows and nothing said so — paging, sort and export ran on the cut copy.
    dir = await mkdtemp(path.join(tmpdir(), 'doc-ingest-'))
    const total = MAX_TABLE_ROWS + 25
    const lines = ['n,label', ...Array.from({ length: total }, (_, i) => `${i},row ${i}`)]
    const file = path.join(dir, 'big.csv')
    await writeFile(file, lines.join('\n'))

    ;(globalThis as { [k: symbol]: unknown })[Symbol.for('localix.mini-app.documents.services')] =
      undefined
    const { tableService } = getDocumentsServices(path.join(dir, 'data'))
    const meta = await tableService.ingest('u1', 's1', { path: file })
    expect('error' in meta ? meta : meta.rowCount).toBe(total)
  })
})
