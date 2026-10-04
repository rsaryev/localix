// REST client for the READ-ONLY effective-agent-configuration diagnostics
// (`GET /rpc/effective-config`). Lives in `shared/api` so the Settings Diagnostics
// view can use it without a same-layer feature→feature import. The endpoint never
// returns a secret value, a connection credential, or a raw system prompt.
import { API_BASE_URL, apiFetch, cleanQuery, unwrap } from '@/shared/api/internal'
import type { EffectiveConfigReport } from '@localixai/api/client'

export const effectiveConfigApi = {
  async get(opts?: {
    projectId?: string
    sessionId?: string
    mode?: string
  }): Promise<EffectiveConfigReport> {
    const qs = new URLSearchParams(cleanQuery(opts)).toString()
    const res = await apiFetch(`${API_BASE_URL}/rpc/effective-config${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    })
    return unwrap<EffectiveConfigReport>(res)
  },
}
