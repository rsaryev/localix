import { assertOk, cleanQuery, client, unwrap } from './internal'
import type { MiniAppRecord } from './contracts'

/**
 * Mini apps (`/rpc/mini-apps`): the installed apps, their switches and settings, and what their
 * screens call. A write answers with no body: the `mini-apps` resource poke tells every surface to
 * re-read the list, so nothing here returns state to patch in. Spread into `backendClient`.
 */
export const miniAppsApi = {
  async listMiniApps(opts?: { projectId?: string | null }): Promise<MiniAppRecord[]> {
    const json = await unwrap(
      await client.rpc['mini-apps'].$get({ query: cleanQuery({ projectId: opts?.projectId }) }),
    )
    return json.miniApps
  },

  async setMiniAppEnabled(
    name: string,
    enabled: boolean,
    opts?: { projectId?: string | null; agentId?: string },
  ): Promise<void> {
    await assertOk(
      await client.rpc['mini-apps'].enable.$post({
        json: {
          name,
          enabled,
          projectId: opts?.projectId ?? null,
          ...(opts?.agentId ? { agentId: opts.agentId } : {}),
        },
      }),
    )
  },

  async setMiniAppConfig(
    name: string,
    values: Record<string, string | number | boolean>,
    opts?: { projectId?: string | null },
  ): Promise<void> {
    await assertOk(
      await client.rpc['mini-apps'].config.$post({
        json: { name, values, projectId: opts?.projectId ?? null },
      }),
    )
  },

  async removeMiniApp(name: string, opts?: { projectId?: string | null }): Promise<void> {
    await assertOk(
      await client.rpc['mini-apps'].remove.$post({
        json: { name, projectId: opts?.projectId ?? null },
      }),
    )
  },

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
}
