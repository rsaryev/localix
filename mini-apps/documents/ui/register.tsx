import { lazy } from 'react'
import { FileText } from 'lucide-react'

import {
  CSV_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
  ODT_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  PPTX_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
  fileExtension,
} from '@localixai/mini-app-sdk/ui/file-types'
import type { FileEditorProps, MiniAppUiHost } from '@localixai/mini-app-sdk/ui'

import { useDocumentsStatusItem } from './statusItem'

/**
 * UI registration for the bundled Documents workbench: the dedicated file viewers
 * (PDF / office document / spreadsheet-as-table) and content-type routing entries.
 * Discovered and invoked generically by
 * `shared/contrib/discover.ts` (`registerUi` export), mirroring the database mini app.
 */

// All bodies render under the editor-grid's WorkItemBody Suspense boundary, so the
// viewers stay off the eager entry chunk and need no local fallback.
const PdfFileTab = lazy(() => import('./PdfFileTab').then((m) => ({ default: m.PdfFileTab })))
const DocumentFileTab = lazy(() =>
  import('./DocumentFileTab').then((m) => ({ default: m.DocumentFileTab })),
)
const TableFileTab = lazy(() => import('./TableFileTab').then((m) => ({ default: m.TableFileTab })))

// Extension families per viewer — the same six formats registered into the
// content-type routing registry below (ONE source for both would re-read the
// registry per match; these viewers own their formats, so the list is theirs).
const PDF_EXTENSIONS = new Set(['pdf'])
const DOCUMENT_EXTENSIONS = new Set(['docx', 'doc', 'odt', 'pptx'])
const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'csv'])

/** Adapt the grid's FileEditorProps to the PDF viewer's props. */
function PdfEditorBody({ path, mediaId, name, sessionId, publishMessageContext }: FileEditorProps) {
  return (
    <PdfFileTab
      path={path}
      mediaId={mediaId}
      name={name}
      sessionId={sessionId}
      publishMessageContext={publishMessageContext}
    />
  )
}

/** Adapt the grid's FileEditorProps to the office-document viewer's props. */
function DocumentEditorBody({
  path,
  mediaId,
  name,
  sessionId,
  publishMessageContext,
}: FileEditorProps) {
  return (
    <DocumentFileTab
      path={path}
      mediaId={mediaId}
      name={name}
      sessionId={sessionId}
      publishMessageContext={publishMessageContext}
    />
  )
}

/** Adapt the grid's FileEditorProps to the spreadsheet-as-table viewer's props. */
function SpreadsheetEditorBody({
  path,
  mediaId,
  name,
  sessionId,
  title,
  publishMessageContext,
}: FileEditorProps) {
  return (
    <TableFileTab
      path={path}
      mediaId={mediaId}
      name={name}
      sessionId={sessionId}
      title={title}
      publishMessageContext={publishMessageContext}
    />
  )
}

let registered = false

/**
 * Test seam: forget that registration already happened.
 *
 * `registered` is module state and `bun test` runs every file in one process, so
 * whichever suite imported this module first consumed the one registration. A suite
 * that captures the contributed handlers by calling `registerUi` with its own stub
 * host then received nothing at all — registration tests failed under
 * `bun test --randomize` with an undefined handler. Re-running against a stub host is
 * harmless: the global registries reject the duplicate keys they already own.
 */
export function __resetDocumentsUiRegistration(): void {
  registered = false
}

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  // The routing registry every core layer consults (grid routing, auto-open of
  // produced documents, drag-to-open, open-externally): this mini app owns the six
  // dedicated-viewer formats. Without the mini app, everything degrades to the
  // plain editor — exactly the honest absence contentTypeRouting documents.
  host.fileFormats.register({
    pdf: { contentType: PDF_CONTENT_TYPE, viewer: 'pdf', openExternally: true },
    docx: { contentType: DOCX_CONTENT_TYPE, viewer: 'document', openExternally: true },
    odt: { contentType: ODT_CONTENT_TYPE, viewer: 'document', openExternally: true },
    pptx: { contentType: PPTX_CONTENT_TYPE, viewer: 'document', openExternally: true },
    xlsx: { contentType: XLSX_CONTENT_TYPE, viewer: 'spreadsheet', openExternally: true },
    csv: { contentType: CSV_CONTENT_TYPE, viewer: 'spreadsheet' },
    // Legacy Office formats — extraction handles them (word-extractor / SheetJS BIFF).
    doc: { contentType: 'application/msword', viewer: 'document', openExternally: true },
    xls: { contentType: 'application/vnd.ms-excel', viewer: 'spreadsheet', openExternally: true },
    xlsm: {
      contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      viewer: 'spreadsheet',
      openExternally: true,
    },
    xlsb: {
      contentType: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
      viewer: 'spreadsheet',
      openExternally: true,
    },
  })

  // Dedicated read-only file viewers, consulted by the grid BEFORE its built-in
  // file routing. `acceptsMedia`: a dropped/uploaded file (no on-disk path) routes
  // by its original NAME and reaches the viewer through its media id.
  host.fileEditors.register({
    id: 'documents:pdf',
    label: 'PDF viewer',
    match: (key) => PDF_EXTENSIONS.has(fileExtension(key)),
    Component: PdfEditorBody,
    acceptsMedia: true,
    // A PDF opens here; Reader and other PDF editors stay under Open with….
    preferred: true,
  })
  host.fileEditors.register({
    id: 'documents:document',
    label: 'Document viewer',
    match: (key) => DOCUMENT_EXTENSIONS.has(fileExtension(key)),
    Component: DocumentEditorBody,
    acceptsMedia: true,
  })
  host.fileEditors.register({
    id: 'documents:spreadsheet',
    label: 'Table view',
    match: (key) => SPREADSHEET_EXTENSIONS.has(fileExtension(key)),
    Component: SpreadsheetEditorBody,
    acceptsMedia: true,
  })

  // Which documents are inside a viewer right now — the mini app's one live fact, declared rather
  // than drawn. It has no workspace to launch, so this is the only chrome it asks for.
  host.statusItems.register({
    id: 'documents:open',
    placement: 'titlebar',
    useItem: useDocumentsStatusItem,
  })

  // Composer @-reference glyph for the `localix://resource/doc` resource provider's nodes.
  host.resourceRefIcons.register({ doc: FileText })
}
