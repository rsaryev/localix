/**
 * REST client for this mini app's own backend (`/rpc/api`).
 *
 * The mini app owns both sides, so the response types come from `../backend/contracts` rather than
 * being restated here — the UI never guesses a shape the backend might change.
 *
 * No `x-user-id` header: the API resolves and sanitises identity at its own boundary, and a
 * browser-set identity would be a self-asserted one.
 */

import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'
import type {
  HistoryEntryInfo,
  HistoryResponse,
  ImportResponse,
  RequestCreate,
  RequestEdit,
  RequestInfo,
  RequestResponse,
  RequestsResponse,
  SendResponse,
} from '../backend/contracts'
import type { RequestAuth } from '../backend/request-spec'
import { enc, readOr, RestApiError, u } from './restApi.transport'
import { environmentApi } from './restApi.environments'

/** The typed failure, re-exported: every call site reaches the client, not its plumbing. */
export { RestApiError }

/**
 * The one client, assembled from its two halves.
 *
 * Spread rather than nested (`restApi.environments.create`) because the caller's question is
 * "what can I ask the API mini app", not "which file is it written in" — and moving a verb between
 * halves must not be a breaking change for the twenty surfaces that call it.
 *
 * Every verb takes the chat it acts for FIRST — the session of the surface that calls it — because
 * the collection lives in that chat's project; see `restApi.transport`.
 */
export const restApi = {
  ...environmentApi,

  async list(sessionId: string, signal?: AbortSignal): Promise<RequestInfo[]> {
    return (
      await readOr<RequestsResponse>(await miniAppApiFetch(u(sessionId)`/requests`, { signal }))
    ).requests
  },

  async folders(sessionId: string, signal?: AbortSignal): Promise<string[]> {
    return (
      await readOr<{ folders: string[] }>(await miniAppApiFetch(u(sessionId)`/folders`, { signal }))
    ).folders
  },

  async createFolder(sessionId: string, name: string): Promise<string> {
    return (
      await readOr<{ folder: string }>(
        await miniAppApiFetch(u(sessionId)`/folders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      )
    ).folder
  },

  async removeFolder(sessionId: string, name: string): Promise<void> {
    await readOr<{ ok: true }>(
      await miniAppApiFetch(u(sessionId)`/folders/${enc(name)}`, { method: 'DELETE' }),
    )
  },

  /** The request AND what it resolves to under the active environment — see ResolvedPreview. */
  async get(sessionId: string, name: string): Promise<RequestResponse> {
    return readOr<RequestResponse>(await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}`))
  },

  /** Mint a new request. A name collision surfaces as `code: 'name_taken'` (409). */
  async create(sessionId: string, input: RequestCreate): Promise<RequestResponse> {
    return readOr<RequestResponse>(
      await miniAppApiFetch(u(sessionId)`/requests`, {
        method: 'POST',
        // JSON content-type forces the cross-origin preflight CORS then denies — see routes.ts.
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  },

  /** Save the editable fields. `auth` goes through its own route — see `setAuth`. */
  async update(sessionId: string, name: string, edit: RequestEdit): Promise<RequestResponse> {
    return readOr<RequestResponse>(
      await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}`, {
        method: 'PUT',
        // The JSON content-type is what forces a cross-origin preflight, which CORS then denies.
        // Not cosmetic — see the schema comment in routes.ts.
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(edit),
      }),
    )
  },

  /** Save the auth block. A secret field left as the mask (`••••••`) keeps the stored value. */
  async setAuth(sessionId: string, name: string, auth: RequestAuth): Promise<RequestResponse> {
    return readOr<RequestResponse>(
      await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/auth`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auth }),
      }),
    )
  },

  async remove(sessionId: string, name: string): Promise<void> {
    await readOr<{ ok: true }>(
      await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}`, { method: 'DELETE' }),
    )
  },

  /** Rename keeps the spec, auth and history; a collision is `code: 'name_taken'` (409). */
  async rename(sessionId: string, name: string, to: string): Promise<RequestInfo> {
    return (
      await readOr<{ request: RequestInfo }>(
        await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/rename`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to }),
        }),
      )
    ).request
  },

  /** Server-side copy under `<name>-copy[-N]` — auth included, without crossing the wire. */
  async duplicate(sessionId: string, name: string): Promise<RequestInfo> {
    return (
      await readOr<{ request: RequestInfo }>(
        await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/duplicate`, { method: 'POST' }),
      )
    ).request
  },

  /** Recent responses, newest first. In-memory on the server — restart empties it. */
  async history(sessionId: string, name: string): Promise<HistoryEntryInfo[]> {
    return (
      await readOr<HistoryResponse>(
        await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/history`),
      )
    ).entries
  },

  /** Clear a request's response history (the in-memory ring for this request only). */
  async clearHistory(sessionId: string, name: string): Promise<void> {
    await readOr<{ ok: true }>(
      await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/history`, { method: 'DELETE' }),
    )
  },

  /** Send by NAME — the backend signs from the STORED spec, so a credential is never sent here. */
  async send(sessionId: string, name: string, signal?: AbortSignal): Promise<SendResponse> {
    return readOr<SendResponse>(
      await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/send`, { method: 'POST', signal }),
    )
  },

  // ── Import / export ───────────────────────────────────────────────────────

  /** Import from pasted text (cURL / OpenAPI / Postman / HAR). `save:false` previews. */
  async importSource(
    sessionId: string,
    body: {
      source: string
      save?: boolean
      baseUrl?: string
    },
  ): Promise<ImportResponse> {
    return readOr<ImportResponse>(
      await miniAppApiFetch(u(sessionId)`/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  },

  /** The request as a cURL command — `${secret:KEY}` refs kept, literals masked. Plain text. */
  async exportCurl(sessionId: string, name: string): Promise<string> {
    const res = await miniAppApiFetch(u(sessionId)`/requests/${enc(name)}/export?format=curl`)
    if (!res.ok) throw new RestApiError(`Export failed (${res.status})`)
    return res.text()
  },
}
