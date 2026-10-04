import { API_BASE_URL, apiFetch, postJson, unwrap } from '@/shared/api/internal'
import type {
  CreateSecretRequest,
  RotateSecretRequest,
  SecretBinding,
  SecretMeta,
  UpdateSecretMetadataRequest,
  VaultAuditEntry,
  VaultVersionMeta,
} from '@localixai/api/client'

const jsonHeaders = { 'content-type': 'application/json' }

export const secretsApi = {
  async list(): Promise<SecretMeta[]> {
    const response = await apiFetch(`${API_BASE_URL}/rpc/secrets`, { method: 'GET' })
    return (await unwrap<{ secrets: SecretMeta[] }>(response)).secrets
  },

  async create(request: CreateSecretRequest): Promise<SecretMeta> {
    const response = await postJson('/rpc/secrets', request)
    return (await unwrap<{ secret: SecretMeta }>(response)).secret
  },

  /** Create-only convenience for connection forms that start from a raw credential. */
  set(request: { key: string; value: string }): Promise<SecretMeta> {
    return this.create({ ...request, type: 'secret', tags: [] })
  },

  async rotate(key: string, request: RotateSecretRequest): Promise<SecretMeta> {
    const response = await apiFetch(`${API_BASE_URL}/rpc/secrets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(request),
    })
    return (await unwrap<{ secret: SecretMeta }>(response)).secret
  },

  async updateMetadata(key: string, request: UpdateSecretMetadataRequest): Promise<SecretMeta> {
    const response = await apiFetch(`${API_BASE_URL}/rpc/secrets/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(request),
    })
    return (await unwrap<{ secret: SecretMeta }>(response)).secret
  },

  async bindings(key: string): Promise<SecretBinding[]> {
    const response = await apiFetch(
      `${API_BASE_URL}/rpc/secrets/${encodeURIComponent(key)}/bindings`,
      { method: 'GET' },
    )
    return (await unwrap<{ bindings: SecretBinding[] }>(response)).bindings
  },

  async versions(key: string): Promise<VaultVersionMeta[]> {
    const response = await apiFetch(
      `${API_BASE_URL}/rpc/secrets/${encodeURIComponent(key)}/versions`,
      { method: 'GET' },
    )
    return (await unwrap<{ versions: VaultVersionMeta[] }>(response)).versions
  },

  async activity(limit = 100): Promise<VaultAuditEntry[]> {
    const response = await apiFetch(
      `${API_BASE_URL}/rpc/secrets/activity?limit=${encodeURIComponent(String(limit))}`,
      { method: 'GET' },
    )
    return (await unwrap<{ activity: VaultAuditEntry[] }>(response)).activity
  },

  async remove(
    key: string,
    options: { expectedVersion?: number; force?: boolean } = {},
  ): Promise<boolean> {
    const query = new URLSearchParams()
    if (options.expectedVersion !== undefined) {
      query.set('expectedVersion', String(options.expectedVersion))
    }
    if (options.force !== undefined) query.set('force', String(options.force))
    const suffix = query.size ? `?${query.toString()}` : ''
    const response = await apiFetch(
      `${API_BASE_URL}/rpc/secrets/${encodeURIComponent(key)}${suffix}`,
      { method: 'DELETE' },
    )
    return (await unwrap<{ deleted: boolean }>(response)).deleted
  },
}
