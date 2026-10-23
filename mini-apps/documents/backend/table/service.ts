/**
 * Table service: lazy paged rows, scalable format export, and "open in native app"
 * with platform detection. The exporter registry + open-target catalog are agnostic
 * (`@localixai/dataview`); detection (fs / PATH) and the process spawn live here.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createDefaultExporterRegistry,
  getOpenTarget,
  openTargetsForPlatform,
  type OpenPlatform,
  type OpenTarget,
  type PageSpec,
  type TableColumn,
  type TableRow,
} from '@localixai/dataview'
import { resolveExecutable } from '@localixai/mini-app-sdk/backend'
import { createXlsxTableExporter } from './xlsx-export'
import type { OpenTargetView, TableMeta, TableRowsResponse } from './contracts'
import type { TableStore } from './store'

export interface TableExportResult {
  filename: string
  mimeType: string
  body: string | Uint8Array
}

/** A tabular extraction of a file — the shape the ingest port hands back. */
export interface IngestedTable {
  columns: TableColumn[]
  rows: TableRow[]
}

/**
 * Narrow port that turns a spreadsheet file into a dataview table — from an absolute
 * path (agent-written / desktop) OR a stored media id (a dropped/uploaded file, which
 * a browser never exposes a path for). Injected at bootstrap from the documents
 * service, so the table service never imports the documents feature. Returns null for
 * a non-tabular file.
 */
export interface TableIngestPort {
  extractTable(input: {
    path?: string
    mediaId?: string
    format?: string
  }): Promise<IngestedTable | null>
}

export interface TableServiceDeps {
  /** Enables `ingest` (open-a-file-as-a-table). Absent → ingest reports unavailable. */
  ingestPort?: TableIngestPort
  resolveSessionDataDir?: (userId: string, sessionId: string) => Promise<string>
  files?: {
    open(path: string): Promise<{ opened: true }>
    openWith(path: string, application: string): Promise<{ opened: true }>
    reveal(path: string): Promise<{ opened: true }>
  }
}

export interface TableService {
  getMeta(userId: string, id: string): Promise<TableMeta | null>
  page(userId: string, id: string, spec: PageSpec): Promise<TableRowsResponse | null>
  exportTable(
    userId: string,
    id: string,
    format: string | undefined,
  ): Promise<TableExportResult | null>
  openTargets(): OpenTargetView[]
  open(userId: string, id: string, targetId: string): Promise<{ opened: true } | TableRefusal>
  /**
   * Ingest a spreadsheet file (csv/xlsx) into a persisted table and return its meta,
   * so the UI can open it in the Table pipeline (lazy rows, sort/filter, export). The
   * file is extracted via the injected documents port; not-tabular / unconfigured →
   * a typed `{ error }`.
   */
  ingest(
    userId: string,
    sessionId: string,
    input: { path?: string; mediaId?: string; name?: string; format?: string },
  ): Promise<TableMeta | TableRefusal>
}

/**
 * Why the service said no. `error` is a STABLE code the route turns into a sentence — never the
 * raw text of whatever threw, which used to be returned here and ended up in the wire envelope's
 * `code` slot with the message left undefined. The raw text rides in `detail`.
 */
export interface TableRefusal {
  error: string
  detail?: string
}

function currentPlatform(): OpenPlatform | null {
  const p = process.platform
  return p === 'darwin' || p === 'win32' || p === 'linux' ? p : null
}

function isTargetAvailable(t: OpenTarget, platform: OpenPlatform): boolean {
  if (!t.platforms.includes(platform)) return false
  if (t.mode === 'default' || t.mode === 'reveal') return true
  const bundles = t.bundlePaths?.[platform] ?? []
  if (bundles.some((p) => existsSync(p))) return true
  const bins = t.binaries?.[platform] ?? []
  // Not a bare `Bun.which`: without an explicit PATH it reads the PATH the process STARTED with —
  // launchd's bare one in the packaged app — and hid LibreOffice installed through Homebrew.
  if (bins.some((b) => resolveExecutable(b) != null)) return true
  return false
}

function safeName(name: string): string {
  return (
    name
      .trim()
      // @safe-file-key-exemption rule -- Slugs a display title; identity comes from the record id.
      // @safe-file-key-exemption fileKey -- Scratch export name is contained and de-collided by record id.
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'table'
  )
}

/**
 * Display base name for a record's export files. Deliberately NOT `safeFileKey`, and the
 * distinction is worth stating because the charset looks identical.
 *
 * This does not sanitize a KEY. It slugs a human TITLE. The file's IDENTITY is supplied
 * separately by the caller — `-${rec.id.slice(0, 8)}` — so this is free to be lossy, and it IS:
 * it TRUNCATES at 64 chars and collapses runs. A file key must never do either (two long keys
 * silently truncating into one file is precisely the failure `safeFileKey` exists to
 * prevent), so the two have OPPOSITE tolerances for lossiness. Same exclusion, and the same
 * reason as any lossy display-name slug: identity is supplied separately.
 *
 * Its three sinks each get what they need, and none of them is key lookup:
 *   - a scratch-dir filename (`openIn`) — contained, and belt-and-braces: the charset kills `/`
 *     and `.`; the edge-strip + `|| 'table'` fallback mean the segment is never empty, `.` or
 *     `..`; and the appended `-<id>.<ext>` suffix means it could not BE a dot-segment even so.
 *   - a `Content-Disposition` header value (`exportTable`) — the charset admits no `"`, CR or LF,
 *     so it cannot break out of the quoted filename or inject a header.
 *   - a download name in the UI.
 *
 * Exported for the pin in `table.test.ts`: this file is allow-listed in the safe-file-key
 * contract as a non-member, and an exception the guard blesses is one a test must keep honest.
 */
export function exportBaseName(rec: { title?: string }): string {
  return safeName(rec.title ?? 'table')
}

export function createTableService(store: TableStore, deps: TableServiceDeps = {}): TableService {
  const exporters = createDefaultExporterRegistry()
  // dataview declares `xlsx` (metadata only); register the real SheetJS serializer
  // over it so the server export/open routes produce genuine workbook bytes.
  exporters.register(createXlsxTableExporter())
  /** Resolve a format (defaulting to CSV) to its exporter; null if even CSV is absent. */
  const resolveExporter = (format?: string) =>
    exporters.get(format ?? 'csv') ?? exporters.get('csv') ?? null

  return {
    async ingest(userId, sessionId, input) {
      if (!deps.ingestPort) return { error: 'ingest_unavailable' }
      let table: IngestedTable | null
      try {
        table = await deps.ingestPort.extractTable({
          path: input.path,
          mediaId: input.mediaId,
          format: input.format,
        })
      } catch (e) {
        return { error: 'ingest_failed', detail: e instanceof Error ? e.message : String(e) }
      }
      if (!table) return { error: 'not_tabular' }
      // Title from the on-disk name, else the dropped file's original name; the media
      // id itself is never a useful title.
      const title = (input.path ? path.basename(input.path) : input.name) || 'table'
      const rec = await store.save({
        userId,
        sessionId,
        title,
        columns: table.columns,
        rows: table.rows,
        view: 'table',
        // Provenance only (rows are persisted); a media-id source has no host path.
        source: input.path ? { kind: 'file', path: input.path } : { kind: 'file' },
      })
      return {
        id: rec.id,
        title: rec.title,
        columns: rec.columns,
        rowCount: rec.rowCount,
        view: rec.view,
        chart: rec.chart,
      }
    },

    async getMeta(userId, id) {
      const rec = await store.get(userId, id)
      if (!rec) return null
      return {
        id: rec.id,
        title: rec.title,
        columns: rec.columns,
        rowCount: rec.rowCount,
        view: rec.view,
        chart: rec.chart,
      }
    },

    async page(userId, id, spec) {
      const page = await store.page(userId, id, spec)
      if (!page) return null
      return { rows: page.rows, total: page.total, offset: page.offset, limit: page.limit }
    },

    async exportTable(userId, id, format) {
      const rec = await store.get(userId, id)
      if (!rec) return null
      const data = await store.getRows(userId, id)
      if (!data) return null
      const exporter = resolveExporter(format)
      if (!exporter) return null
      return {
        filename: `${exportBaseName(rec)}.${exporter.extension}`,
        mimeType: exporter.mimeType,
        body: exporter.serialize(data.columns, data.rows),
      }
    },

    openTargets() {
      const platform = currentPlatform()
      if (!platform) return []
      return openTargetsForPlatform(platform).flatMap((t) =>
        isTargetAvailable(t, platform) ? [{ id: t.id, label: t.label }] : [],
      )
    },

    async open(userId, id, targetId) {
      const platform = currentPlatform()
      if (!platform) return { error: 'unsupported_platform' }
      const rec = await store.get(userId, id)
      if (!rec) return { error: 'table_not_found' }
      const target = getOpenTarget(targetId)
      if (!target || !isTargetAvailable(target, platform)) return { error: 'target_unavailable' }
      const data = await store.getRows(userId, id)
      if (!data) return { error: 'table_not_found' }
      if (!deps.resolveSessionDataDir || !deps.files) return { error: 'host_files_unavailable' }

      const exporter = resolveExporter(target.exporterId)
      if (!exporter) return { error: 'no_exporter' }
      const bytes = exporter.serialize(data.columns, data.rows)

      try {
        const dir = path.join(
          await deps.resolveSessionDataDir(userId, rec.sessionId),
          'table-exports',
        )
        await mkdir(dir, { recursive: true })
        const file = path.join(
          dir,
          `${exportBaseName(rec)}-${rec.id.slice(0, 8)}.${exporter.extension}`,
        )
        await writeFile(file, bytes)

        if (target.mode === 'reveal') await deps.files.reveal(file)
        else if (target.mode === 'app' && target.app?.[platform])
          await deps.files.openWith(file, target.app[platform]!)
        else await deps.files.open(file)
        return { opened: true }
      } catch (e) {
        return { error: 'open_failed', detail: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
