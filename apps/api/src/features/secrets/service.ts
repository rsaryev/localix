import { ApiError } from '../../lib/errors'
import type {
  CreateSecretRequest,
  RotateSecretRequest,
  SecretBinding,
  SecretMeta,
  UpdateSecretMetadataRequest,
  VaultAuditEntry,
  VaultVersionMeta,
} from './contracts'
import type { SecretsStore, VaultDeleteResult } from './store'

export interface SecretsService {
  list(userId: string): Promise<SecretMeta[]>
  versions(userId: string, key: string): Promise<VaultVersionMeta[]>
  activity(userId: string, limit?: number): Promise<VaultAuditEntry[]>
  create(userId: string, request: CreateSecretRequest): Promise<SecretMeta>
  rotate(userId: string, key: string, request: RotateSecretRequest): Promise<SecretMeta>
  updateMetadata(
    userId: string,
    key: string,
    request: UpdateSecretMetadataRequest,
  ): Promise<SecretMeta>
  bindings(userId: string, key: string): Promise<SecretBinding[]>
  remove(
    userId: string,
    key: string,
    options?: { expectedVersion?: number; force?: boolean },
  ): Promise<VaultDeleteResult>
}

export function createSecretsService(store: SecretsStore): SecretsService {
  return {
    list: (userId) => store.list(userId),
    versions: (userId, key) => store.listVersions(userId, key),
    activity: (userId, limit) => store.listAudit(userId, limit),

    async create(userId, request) {
      const item = await store.create(userId, request)
      if (!item) {
        throw new ApiError(
          409,
          'vault_alias_exists',
          `A Vault item already uses the alias "${request.key}". Rotate it explicitly instead.`,
        )
      }
      return item
    },

    async rotate(userId, key, request) {
      const result = await store.rotate(userId, key, request.value, request.expectedVersion)
      if (result.status === 'updated') return result.item
      if (result.status === 'missing') {
        throw new ApiError(404, 'vault_item_not_found', 'Vault item not found')
      }
      throw new ApiError(
        409,
        'vault_version_conflict',
        `Vault item changed (current version ${result.currentVersion}). Refresh before rotating.`,
      )
    },

    async updateMetadata(userId, key, request) {
      const result = await store.updateMetadata(userId, key, request)
      if (result.status === 'updated') return result.item
      if (result.status === 'missing') {
        throw new ApiError(404, 'vault_item_not_found', 'Vault item not found')
      }
      throw new ApiError(
        409,
        'vault_version_conflict',
        `Vault item changed (current version ${result.currentVersion}). Refresh before editing.`,
      )
    },

    bindings: (userId, key) => store.listBindings(userId, key),

    remove: (userId, key, options) => store.remove(userId, key, options),
  }
}
