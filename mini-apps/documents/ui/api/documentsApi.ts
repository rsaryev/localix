import {
  postMiniAppJson as postJson,
  unwrapMiniAppResponse,
} from '@localixai/mini-app-sdk/ui/transport'
import type { DocumentFormat, ExtractOptions, ExtractResponse } from '../docClient'

/** Point the extractor at bytes via an absolute file `path` OR a stored `mediaId`. */
export interface ExtractInput {
  path?: string
  mediaId?: string
  /** Override auto-detection (from the path extension / media type). */
  format?: DocumentFormat
  mediaType?: string
  /** Narrow the extraction (page/sheet window, row/char offset+limit). */
  options?: ExtractOptions
}

/**
 * REST client for the document-extraction service (`POST /rpc/documents/extract`).
 * Backs the inspector office/PDF viewers: office text/slides → Markdown, spreadsheets
 * → a dataview table. The heavy extraction is cached content-addressed server-side.
 * Raw fetch (not the typed hono client): the route is mounted by the bundled
 * documents MINI APP, so it is not part of core's `AppType`.
 *
 * Failures arrive as `MiniAppApiError`, carrying the route's classified sentence and the
 * extraction library's own words in `detail`. This file used to hand-roll that reader,
 * because the SDK's unwrap saw only the host's NESTED envelope and this route answers the
 * flat `{ error, code, detail }` one. The SDK reads both now, so the copy is gone.
 */
export const documentsApi = {
  async extract(input: ExtractInput): Promise<ExtractResponse> {
    return unwrapMiniAppResponse<ExtractResponse>(await postJson('/rpc/documents/extract', input))
  },
}
