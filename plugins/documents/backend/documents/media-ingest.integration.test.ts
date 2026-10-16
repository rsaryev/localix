import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMediaStore } from '../../../../apps/api/src/features/media/store'
import { createDocumentStore } from './store'
import { createDocumentsService } from './service'
import { createCsvConverter } from './drivers/csv'
import { createTableStore } from '../table/store'
import { createTableService } from '../table/service'

// End-to-end proof of the drag-to-open web chain with REAL components (no fakes),
// mirroring the bootstrap wiring: a dropped file's bytes land in the media store,
// then the document/table pipelines re-extract them BY CONTENT ID — with the format
// detected from the media id's extension alone (no path, no explicit mediaType).

const tmpRoots: string[] = []
async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `localix-${prefix}-`))
  tmpRoots.push(dir)
  return join(dir, prefix)
}
afterAll(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true })
})

async function wire() {
  const mediaStore = createMediaStore({ dir: await freshDir('media') })
  const documentsService = createDocumentsService({
    store: createDocumentStore({ dir: await freshDir('documents') }),
    // Only CSV is exercised here; keep the converter light + deterministic.
    converterFor: () => createCsvConverter(),
    // Exactly the bootstrap wiring: resolve a media id to its bytes.
    loadMediaBytes: async (id) => {
      const b64 = await mediaStore.getBase64(id)
      return b64 ? Buffer.from(b64, 'base64') : null
    },
  })
  const tableService = createTableService(createTableStore({ dir: await freshDir('tables') }), {
    ingestPort: {
      extractTable: async ({ path, mediaId }) => {
        const { document } = await documentsService.extract({ path, mediaId })
        return document.kind === 'table' ? { columns: document.columns, rows: document.rows } : null
      },
    },
  })
  return { mediaStore, documentsService, tableService }
}

describe('drag-to-open: media-id ingest chain (real components)', () => {
  test('a dropped CSV → media store → extract-by-mediaId → a persisted table', async () => {
    const { mediaStore, tableService } = await wire()
    // A browser drop materializes here (mediaTypeForName picks text/csv → `.csv` id).
    const csv = 'name,score\nada,10\nlin,7\n'
    const { id } = await mediaStore.putBytes(new TextEncoder().encode(csv), 'text/csv')
    expect(id.endsWith('.csv')).toBe(true)

    // The Table viewer's ingestMedia path — NO host path, only the content id + name.
    const res = await tableService.ingest('u1', 's1', { mediaId: id, name: 'scores.csv' })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.title).toBe('scores.csv')
    expect(res.rowCount).toBe(2)

    const page = await tableService.page('u1', res.id, {})
    expect(page?.total).toBe(2)
    // The CSV rows survived extraction with their values (typed by the converter).
    expect(JSON.stringify(page?.rows)).toContain('ada')
    expect(JSON.stringify(page?.rows)).toContain('lin')
  })

  test('a dropped office/CSV extracts by mediaId with the format from the id extension', async () => {
    const { mediaStore, documentsService } = await wire()
    const { id } = await mediaStore.putBytes(new TextEncoder().encode('a,b\n1,2\n'), 'text/csv')
    // No mediaType, no path, no format — detection must fall back to the `.csv` id ext.
    const { document } = await documentsService.extract({ mediaId: id })
    expect(document.kind).toBe('table')
  })
})
