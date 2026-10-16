import type {
  CreateSecretRequest,
  SecretMeta,
  UpdateSecretMetadataRequest,
  VaultAuditEntry,
  VaultItemSource,
  VaultItemType,
  VaultVersionMeta,
} from './contracts'

export interface VaultItemMetadata {
  label?: string
  description?: string
  type?: VaultItemType
  source?: VaultItemSource
  tags?: string[]
  backend?: string
  audit?: VaultUseContext
}

export type VaultResolution =
  | { status: 'ok'; value: string; itemId: string; version: number }
  | { status: 'missing' }
  | { status: 'corrupt'; itemId: string }
  | { status: 'unavailable'; itemId: string; backend: string }

export type VaultMutationResult =
  | { status: 'updated'; item: SecretMeta }
  | { status: 'missing' }
  | { status: 'conflict'; currentVersion: number }

export interface VaultBinding {
  consumerType: string
  consumerId: string
  field: string
  label: string
}

export type VaultDeleteResult =
  | { status: 'deleted' }
  | { status: 'missing' }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'in_use'; bindings: VaultBinding[] }

export interface VaultUseContext {
  actorType?: 'user' | 'agent' | 'plugin' | 'system'
  actorId?: string
  consumerType?: string
  consumerId?: string
}

export interface SecretsStore {
  list(userId: string): Promise<SecretMeta[]>
  listVersions(userId: string, key: string): Promise<VaultVersionMeta[]>
  listAudit(userId: string, limit?: number): Promise<VaultAuditEntry[]>
  create(userId: string, request: CreateSecretRequest): Promise<SecretMeta | null>
  rotate(
    userId: string,
    key: string,
    value: string,
    expectedVersion: number,
    audit?: VaultUseContext,
  ): Promise<VaultMutationResult>
  updateMetadata(
    userId: string,
    key: string,
    request: UpdateSecretMetadataRequest,
    audit?: VaultUseContext,
  ): Promise<VaultMutationResult>
  /**
   * Trusted managed-item upsert used by provider adapters. Public UI writes use
   * create/rotate so an existing credential is never replaced accidentally.
   */
  set(userId: string, key: string, value: string, metadata?: VaultItemMetadata): Promise<SecretMeta>
  setIfAbsent(
    userId: string,
    key: string,
    value: string,
    metadata?: VaultItemMetadata,
  ): Promise<boolean>
  remove(
    userId: string,
    key: string,
    options?: { expectedVersion?: number; force?: boolean; audit?: VaultUseContext },
  ): Promise<VaultDeleteResult>
  /** Trusted lifecycle delete (provider connection removal). */
  delete(userId: string, key: string): Promise<boolean>
  has(userId: string, key: string): Promise<boolean>
  resolveDetailed(userId: string, key: string, use?: VaultUseContext): Promise<VaultResolution>
  /** SERVER-INTERNAL. Never expose the returned value through routes/tools/events. */
  resolve(userId: string, key: string, use?: VaultUseContext): Promise<string | null>
  listBindings(userId: string, key: string): Promise<VaultBinding[]>
  bind(userId: string, key: string, binding: VaultBinding): Promise<boolean>
}
