import { client, unwrap } from './internal'

export interface SystemToggleState {
  id: string
  title: string
  description?: string
  enabled: boolean
  available: boolean
}

/**
 * Host-level system controls (keep-awake, …). Generic over a toggle `id` so new
 * controls need no client changes — see apps/api/src/features/system.
 */
export const systemApi = {
  async listSystemToggles(): Promise<SystemToggleState[]> {
    const json = await unwrap(await client.rpc.system.toggles.$get())
    return json.toggles
  },

  async setSystemToggle(id: string, enabled: boolean): Promise<SystemToggleState> {
    return unwrap(
      await client.rpc.system.toggles[':id'].$post({ param: { id }, json: { enabled } }),
    )
  },
}
