/**
 * Documents workbench — bundled first-party mini app backend.
 *
 * `register(ctx)` gets (or lazily builds) the process-wide documents + table
 * services and contributes them as two `BackendSubsystem`s: the boot-time loader
 * mounts the routes (`/rpc/documents`, `/rpc/table`) and registers the typed
 * capability core consumes through the SDK registry:
 *
 *   - `document.extract` — the narrow port behind the `Read` tool's office/PDF fallback
 *     and attachment-spill text previews. There is no `documents.generate` capability:
 *     generation is reachable through `POST /rpc/documents/generate`, not a model tool.
 *
 * Host couplings arrive through the GENERIC mini app host seam only: media bytes
 * in/out via `ctx.host.media` (a dropped document's bytes; persisting generated
 * docx/xlsx/pdf). The mini app never imports the core media store.
 */
import {
  CAP_DOCUMENT_EXTRACT,
  type Capabilities,
  type MiniAppContext,
  type MiniAppRegistration,
} from '@localixai/mini-app-sdk/backend'
import { getDocumentsServices, type DocumentsHost } from './singleton'
import { buildDocumentExtractPort } from './extract-port'
import { createDocumentsRoutes } from './documents/routes'
import { createTableRoutes } from './table/routes'
import { createDocumentsResourceProvider } from './resource-provider'
import { readDocumentFontsFrom } from './documents/generators/fonts'

/** The generic host capabilities this mini app reads off the register context —
 *  a structural subset of the host `MiniAppContext` (see the database mini app). */
interface DocumentsRegisterContext extends Pick<
  MiniAppContext,
  'dataDir' | 'userId' | 'miniAppDir'
> {
  host?: DocumentsHost
  /** The session's working directory — relative tool paths resolve against it. */
  cwd?: string
}

export function register(ctx: DocumentsRegisterContext): MiniAppRegistration {
  // The generators read their fonts from this app's own folder: the archive carries them once.
  if (ctx.miniAppDir) readDocumentFontsFrom(ctx.miniAppDir)
  // Boot-time call supplies the real media seam; per-run tool loads reuse the
  // already-built singleton (whose bound seam stays live).
  const media = ctx.host?.media
  const { documentsService, tableService, documentStore, recents } = getDocumentsServices(
    ctx.dataDir,
    ctx.host,
  )

  const extractPort = buildDocumentExtractPort(documentsService)
  const capabilities: Capabilities = {
    [CAP_DOCUMENT_EXTRACT]: extractPort,
  }

  return {
    backend: [
      {
        id: 'documents:document',
        routeMount: {
          path: '/rpc/documents',
          app: createDocumentsRoutes(documentsService, {
            // Persist generated docx/xlsx/pdf bytes through the host media seam so
            // `POST /generate` hands back a stable id (served via /rpc/media/:id).
            saveMedia: media
              ? async (bytes, mediaType) => {
                  const { id } = await media.putBytes(bytes, mediaType)
                  return { id, size: bytes.byteLength }
                }
              : undefined,
          }),
        },
        // `localix://resource/doc` — recently-extracted documents become @-mentionable (flat tree;
        // expand → the same bounded Markdown the extractor renders).
        resourceProvider: createDocumentsResourceProvider({ store: documentStore, recents }),
        capabilities,
      },
      {
        id: 'documents:table',
        routeMount: { path: '/rpc/table', app: createTableRoutes(tableService) },
      },
    ],
    // NO agent tools. This mini app is a WORKBENCH and a set of capability ports, not a
    // model surface: the Table tab, the document viewers, the `doc` resource provider and
    // the search/context providers are all user-facing, and `extract` is consumed by the
    // core `Read` tool (office/PDF files come back as text instead of a binary refusal).
    //
    // This workbench contributes no model-facing tool schema. Core `read` consumes the
    // extraction port; generation and spreadsheet browsing stay application surfaces.
    tools: [],
  }
}
