import { assertOk, cleanQuery, client, unwrap } from './internal'
import type { MiniAppCatalogEntryRecord } from '@localixai/api/client'

/**
 * Mini apps (`/rpc/mini-apps`): what their screens and commands call, their icons, catalogs and
 * installs. Switching one on or off and removing it go through the Store; a write answers with no
 * body, and the `mini-apps` resource poke tells every surface to re-read. Spread into
 * `backendClient`.
 */
export const miniAppsApi = {
  /**
   * Resolve a mini app command arg's DYNAMIC options on demand (its composer picker). The server
   * runs the app's declared options script; failures yield `[]`.
   */
  async fetchMiniAppCommandArgOptions(input: {
    app: string
    command: string
    arg: string
    query?: string
    sessionId?: string
    projectId?: string | null
  }): Promise<{ value: string; label: string; description?: string }[]> {
    const json = await unwrap(
      await client.rpc['mini-apps']['command-args'].options.$post({
        json: {
          app: input.app,
          command: input.command,
          arg: input.arg,
          ...(input.query ? { query: input.query } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {}),
        },
      }),
    )
    return json.options
  },

  /** One enabled view's sandboxed HTML. */
  async getMiniAppViewHtml(
    app: string,
    viewId: string,
    opts?: { projectId?: string | null },
  ): Promise<string> {
    const json = await unwrap(
      await client.rpc['mini-apps'].views[':app'][':id'].$get({
        param: { app, id: viewId },
        query: cleanQuery({ projectId: opts?.projectId }),
      }),
    )
    return json.html
  },

  /** Host-brokered call from a sandboxed surface to its owning mini app's backend. */
  async invokeMiniAppUiAction(input: {
    app: string
    projectId?: string | null
    viewId: string
    sessionId?: string | null
    action: string
    payload?: unknown
  }): Promise<unknown> {
    const json = await unwrap(
      await client.rpc['mini-apps']['ui-actions'].invoke.$post({
        json: {
          app: input.app,
          viewId: input.viewId,
          action: input.action,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        },
      }),
    )
    return json.result
  },

  /**
   * An installed mini app's own icon file, as the host serves it from its manifest; `null` when
   * it names none. The body is the picture's bytes, so it is read as a blob, not through `unwrap`.
   */
  async getMiniAppIcon(app: string): Promise<Blob | null> {
    const response = await client.rpc['mini-apps'][':app'].icon.$get({
      param: { app },
      query: {},
    })
    return response.ok ? response.blob() : null
  },

  /** Queue an install; its progress arrives as `store` pokes. */
  async installMiniApp(name: string, opts?: { acceptUnverified?: boolean }): Promise<void> {
    await assertOk(await client.rpc['mini-apps'].store.install.$post({ json: { name, ...opts } }))
  },

  /** The catalogs the store reads, Localix's own first. */
  async listMiniAppCatalogs(): Promise<MiniAppCatalogEntryRecord[]> {
    return (await unwrap(await client.rpc['mini-apps'].catalogs.$get())).catalogs
  },
}
