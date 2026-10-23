/**
 * Filesystem-backed table store. Spreadsheet ingestion persists metadata + rows
 * under the mini app data directory and returns an id. The Table tab fetches rows lazily by id over
 * `/rpc/table/:id/rows` (server-side sort/filter/page), so a large table never rides through the
 * model context. Restart-safe: the tab re-fetches and the store rebuilds from disk.
 *
 * Agnostic: knows nothing about chat/providers — rows in, id out, pages back.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import {
  pageRows,
  type ChartSpec,
  type PagedRows,
  type PageSpec,
  type TableColumn,
  type TableFormat,
  type TableRow,
  type ViewKind,
} from '@localixai/dataview'

export interface TableSource {
  kind: 'file' | 'inline'
  /** file: the source path the agent pointed at (provenance only — rows are persisted). */
  path?: string
  format?: TableFormat
}

export interface TableRecord {
  id: string
  userId: string
  sessionId: string
  title?: string
  columns: TableColumn[]
  rowCount: number
  view: ViewKind
  chart?: ChartSpec
  source: TableSource
}

export interface SaveTableInput {
  userId: string
  sessionId: string
  title?: string
  columns: TableColumn[]
  rows: TableRow[]
  view: ViewKind
  chart?: ChartSpec
  source: TableSource
}

export interface TableStore {
  save(input: SaveTableInput): Promise<TableRecord>
  get(userId: string, id: string): Promise<TableRecord | null>
  getRows(userId: string, id: string): Promise<{ columns: TableColumn[]; rows: TableRow[] } | null>
  page(
    userId: string,
    id: string,
    spec: PageSpec,
  ): Promise<(PagedRows & { columns: TableColumn[] }) | null>
}

/** Random uuid id; guards the route + dir join against traversal. */
const ID_RE = /^[a-z0-9-]{8,64}$/
export function isTableId(id: string): boolean {
  return ID_RE.test(id)
}

export interface TableStoreOptions {
  dir: string
  /** Soft cap on in-memory row sets (LRU-ish eviction). */
  rowCacheCap?: number
}

export function createTableStore(options: TableStoreOptions): TableStore {
  const { dir } = options
  const cap = options.rowCacheCap ?? 50
  // Meta records are tiny (columns + counts, no rows), so they get a far larger
  // cap than the row sets — but a cap all the same: without one, metaCache grows
  // by one entry per DISTINCT table id ever read and never sheds them, so a
  // long-lived process that opens many tables leaks unboundedly. Eviction is a
  // pure cache miss (re-read meta.json), so it only bites past the cap.
  const metaCap = cap * 8
  const metaCache = new Map<string, TableRecord>()
  const rowsCache = new Map<string, TableRow[]>()

  const tableDir = (id: string) => path.join(dir, id)
  const metaPath = (id: string) => path.join(tableDir(id), 'meta.json')
  const rowsPath = (id: string) => path.join(tableDir(id), 'rows.json')

  // FIFO-evict the oldest entry once `map` overflows `limit` (insertion order is
  // Map iteration order). Re-setting an existing key does not reorder it, which is
  // fine here — these are read-through caches, not access-ordered LRUs.
  const capMap = <V>(map: Map<string, V>, limit: number) => {
    if (map.size > limit) {
      const oldest = map.keys().next().value
      if (oldest !== undefined) map.delete(oldest)
    }
  }

  const cacheRows = (id: string, rows: TableRow[]) => {
    rowsCache.set(id, rows)
    capMap(rowsCache, cap)
  }

  const cacheMeta = (id: string, rec: TableRecord) => {
    metaCache.set(id, rec)
    capMap(metaCache, metaCap)
  }

  const readMeta = async (id: string): Promise<TableRecord | null> => {
    const cached = metaCache.get(id)
    if (cached) return cached
    try {
      const rec = JSON.parse(await readFile(metaPath(id), 'utf8')) as TableRecord
      cacheMeta(id, rec)
      return rec
    } catch {
      return null
    }
  }

  return {
    async save(input) {
      const id = randomUUID()
      const record: TableRecord = {
        id,
        userId: input.userId,
        sessionId: input.sessionId,
        title: input.title,
        columns: input.columns,
        rowCount: input.rows.length,
        view: input.view,
        chart: input.chart,
        source: input.source,
      }
      // Crumple-zone ordering (Release It! — a failure must not leave half-applied
      // state): meta.json is the record `get` keys existence on, so it is the COMMIT
      // point and must land LAST. Write rows.json first — a throw before meta lands
      // leaves an inert, un-listable orphan rather than a discoverable-but-unreadable
      // "zombie" table (meta present, rows missing → every read returns null). Both
      // writes are atomic (temp+rename) so a torn file never surfaces either.
      await atomicWriteFile(rowsPath(id), JSON.stringify(input.rows))
      await atomicWriteFile(metaPath(id), JSON.stringify(record))
      cacheMeta(id, record)
      cacheRows(id, input.rows)
      return record
    },

    async get(userId, id) {
      if (!isTableId(id)) return null
      const rec = await readMeta(id)
      if (!rec || rec.userId !== userId) return null
      return rec
    },

    async getRows(userId, id) {
      const rec = await this.get(userId, id)
      if (!rec) return null
      const cached = rowsCache.get(id)
      if (cached) return { columns: rec.columns, rows: cached }
      try {
        const rows = JSON.parse(await readFile(rowsPath(id), 'utf8')) as TableRow[]
        cacheRows(id, rows)
        return { columns: rec.columns, rows }
      } catch {
        return null
      }
    },

    async page(userId, id, spec) {
      const data = await this.getRows(userId, id)
      if (!data) return null
      return { ...pageRows(data.rows, spec, data.columns), columns: data.columns }
    },
  }
}
