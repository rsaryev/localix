import { client, unwrap } from '@/shared/api/internal'
import type {
  CreateSecretRequest,
  RotateSecretRequest,
  SecretBinding,
  SecretMeta,
  UpdateSecretMetadataRequest,
  VaultAuditEntry,
  VaultVersionMeta,
} from '@localixai/api/client'

export const secretsApi = {
  async list(): Promise<SecretMeta[]> {
    return (await unwrap(await client.rpc.secrets.$get())).secrets
  },

  async create(request: CreateSecretRequest): Promise<SecretMeta> {
    return (await unwrap(await client.rpc.secrets.$post({ json: request }))).secret
  },

  /** Create-only convenience for connection forms that start from a raw credential. */
  set(request: { key: string; value: string }): Promise<SecretMeta> {
    return this.create({ ...request, type: 'secret', tags: [] })
  },

  async rotate(key: string, request: RotateSecretRequest): Promise<SecretMeta> {
    const response = await client.rpc.secrets[':key'].$put({ param: { key }, json: request })
    return (await unwrap(response)).secret
  },

  async updateMetadata(key: string, request: UpdateSecretMetadataRequest): Promise<SecretMeta> {
    const response = await client.rpc.secrets[':key'].$patch({ param: { key }, json: request })
    return (await unwrap(response)).secret
  },

  async bindings(key: string): Promise<SecretBinding[]> {
    const response = await client.rpc.secrets[':key'].bindings.$get({ param: { key } })
    return (await unwrap(response)).bindings
  },

  async versions(key: string): Promise<VaultVersionMeta[]> {
    const response = await client.rpc.secrets[':key'].versions.$get({ param: { key } })
    return (await unwrap(response)).versions
  },

  async activity(limit = 100): Promise<VaultAuditEntry[]> {
    const response = await client.rpc.secrets.activity.$get({ query: { limit: String(limit) } })
    return (await unwrap(response)).activity
  },

  async remove(
    key: string,
    options: { expectedVersion?: number; force?: boolean } = {},
  ): Promise<boolean> {
    const query: { expectedVersion?: string; force?: 'true' | 'false' } = {}
    if (options.expectedVersion !== undefined)
      query.expectedVersion = String(options.expectedVersion)
    if (options.force !== undefined) query.force = options.force ? 'true' : 'false'
    const response = await client.rpc.secrets[':key'].$delete({ param: { key }, query })
    return (await unwrap(response)).deleted
  },
}
