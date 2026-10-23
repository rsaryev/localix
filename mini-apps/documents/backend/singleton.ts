/**
 * Process-wide documents/table services for the bundled documents mini app.
 *
 * `register()` runs on every load (boot-time backend load AND per-run tool load),
 * but the extraction cache, table store and their in-memory state must be one
 * instance per process — so the services live on `globalThis`, keyed by a symbol.
 * The boot-time load carries the real `ctx.host.media` seam; later loads reuse the
 * already-built singleton. A boot load with a REAL media seam replaces a stub-built
 * instance (latest-real-host-wins), so ordering quirks can't strand a media-less
 * service.
 */
import path from 'node:path'
import type { MiniAppHostServices } from '@localixai/mini-app-sdk/backend'
import { createDocumentsService, type DocumentsService } from './documents/service'
import { createDocumentStore, type DocumentStore } from './documents/store'
import { createTableService, type TableService } from './table/service'
import { createTableStore, type TableStore } from './table/store'
import { createRecentsIndex, type RecentsIndex } from './recents'

/** Structural mirror of the host media seam (`ctx.host.media`). */
export type DocumentsHost = Pick<MiniAppHostServices, 'files' | 'media' | 'sessionStorage'>

export interface DocumentsServices {
  documentsService: DocumentsService
  tableService: TableService
  tableStore: TableStore
  documentStore: DocumentStore
  /** Recent-extraction index behind the `localix://resource/doc` resource tree. */
  recents: RecentsIndex
  /** The media seam captured at build time (undefined on a host-less build). */
  media?: NonNullable<MiniAppHostServices['media']>
  hostFiles?: NonNullable<MiniAppHostServices['files']>
}

const KEY = Symbol.for('localix.mini-app.documents.services')

type Holder = { services?: DocumentsServices }
function holder(): Holder {
  const g = globalThis as { [k: symbol]: Holder | undefined }
  return (g[KEY] ??= {})
}

function build(dataDir: string, host?: DocumentsHost): DocumentsServices {
  // Document extraction — agnostic office/PDF/text → Markdown or a dataview table,
  // cached content-addressed beside the db (`~/.localix/documents/`). Bytes come from
  // an absolute path OR a media content id (resolved via the host media seam, so the
  // service never imports the media store).
  const documentsDir = path.join(dataDir, 'extractions')
  const documentStore = createDocumentStore({ dir: documentsDir })
  const recents = createRecentsIndex({ dir: documentsDir })
  const inner = createDocumentsService({
    store: documentStore,
    loadMediaBytes: async (id) => {
      const bytes = await host?.media?.getBytes(id)
      return bytes ? Buffer.from(bytes) : null
    },
  })
  // Decorate extract with the recents index (the `localix://resource/doc` tree's memory): every
  // successful extraction — tool, route, ingest — lands there. Best-effort by
  // construction (record never throws), so an unwritable index can't fail a read.
  const documentsService: DocumentsService = {
    ...inner,
    extract: async (input) => {
      const res = await inner.extract(input)
      await recents.record({
        id: res.id,
        source: input.path ? path.basename(input.path) : (input.mediaId ?? 'document'),
        format: res.document.metadata.format,
        title: res.document.metadata.title,
        at: Date.now(),
      })
      return res
    },
  }
  // Filesystem table store + service — backs the inspector Table tab
  // (lazy paged rows, CSV/XLSX export, open in native app).
  // The ingest port lets a csv/xlsx file-open become a table via the documents
  // service (format auto-detected from the path); non-tabular files return null.
  const tableStore = createTableStore({ dir: path.join(dataDir, 'tables') })
  const tableService = createTableService(tableStore, {
    resolveSessionDataDir: host?.sessionStorage
      ? (userId, sessionId) => host.sessionStorage!.resolveDataDir(userId, sessionId)
      : undefined,
    files: host?.files,
    ingestPort: {
      extractTable: async ({ path, mediaId }) => {
        const { id, document: windowed } = await documentsService.extract({ path, mediaId })
        // `extract` answers with a WINDOW capped at MAX_TABLE_ROWS — sized for a model's context,
        // not for a table. Ingesting that window silently kept 10,000 rows of a larger sheet, and
        // paging, sort and export all ran on the cut copy. The cache holds the full extraction.
        const document = (await documentStore.get(id)) ?? windowed
        return document.kind === 'table' ? { columns: document.columns, rows: document.rows } : null
      },
    },
  })
  return {
    documentsService,
    tableService,
    tableStore,
    documentStore,
    recents,
    media: host?.media,
    hostFiles: host?.files,
  }
}

/** Get (or lazily build) the process-wide services. A real `media` seam upgrades
 *  a previously host-less build. */
export function getDocumentsServices(dataDir: string, host?: DocumentsHost): DocumentsServices {
  const h = holder()
  if (!h.services || (host?.media && !h.services.media) || (host?.files && !h.services.hostFiles)) {
    h.services = build(dataDir, host)
  }
  return h.services
}
