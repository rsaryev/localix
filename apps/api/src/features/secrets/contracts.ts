import { VAULT_ITEM_TYPES, type VaultItemType } from './vault-item-types'
export { VAULT_ITEM_TYPES, VAULT_ITEM_TYPE_DEFINITIONS } from './vault-item-types'
export type { VaultItemType } from './vault-item-types'
import { z } from 'zod'

import {
  SECRET_KEY_HINT,
  SECRET_KEY_MAX_LENGTH,
  SECRET_KEY_PATTERN,
  SECRET_VALUE_MAX_LENGTH,
} from './limits'

/**
 * Central secrets store contracts. A secret is a `key → value` pair; the VALUE is
 * write-only — no API ever reads it back to the client or the model. Configs reference
 * a secret by an opaque handle `secret:<KEY>`, resolved server-side only.
 */

/** Prefix of a secret handle embedded in a config string (`secret:DB_PASS`). */
export const SECRET_PREFIX = 'secret:'

/**
 * A secret key: identifier-ish so it is safe in files, handles, and UI.
 * DERIVED from the zod-free `./limits` leaf, which the settings form validates
 * against too — so the client can never green-light a key this schema will reject.
 */
export const secretKeySchema = z
  .string()
  .min(1)
  .max(SECRET_KEY_MAX_LENGTH)
  .regex(SECRET_KEY_PATTERN, SECRET_KEY_HINT)

export const vaultItemTypeSchema = z.enum(VAULT_ITEM_TYPES)

export const vaultItemSourceSchema = z.enum(['user', 'provider', 'plugin', 'system'])
export type VaultItemSource = z.infer<typeof vaultItemSourceSchema>

const editableMetadataSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  type: vaultItemTypeSchema.default('secret'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
})

/** Public create is create-only. It can never replace an existing credential. */
export const createSecretRequestSchema = editableMetadataSchema.extend({
  key: secretKeySchema,
  value: z.string().min(1).max(SECRET_VALUE_MAX_LENGTH),
})
export type CreateSecretRequest = z.infer<typeof createSecretRequestSchema>

/** Explicit rotation uses optimistic concurrency so a stale tab cannot win silently. */
export const rotateSecretRequestSchema = z.object({
  value: z.string().min(1).max(SECRET_VALUE_MAX_LENGTH),
  expectedVersion: z.number().int().positive(),
})
export type RotateSecretRequest = z.infer<typeof rotateSecretRequestSchema>

/**
 * Value-free metadata edit. It still advances the immutable Vault version so
 * optimistic concurrency covers titles/descriptions/tags as well as rotations.
 */
export const updateSecretMetadataRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    type: vaultItemTypeSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.title === undefined &&
      input.description === undefined &&
      input.type === undefined &&
      input.tags === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'At least one metadata field must be provided',
      })
    }
  })
export type UpdateSecretMetadataRequest = z.infer<typeof updateSecretMetadataRequestSchema>

export const secretKeyParamsSchema = z.object({ key: secretKeySchema })
export const deleteSecretQuerySchema = z.object({
  expectedVersion: z.coerce.number().int().positive().optional(),
  force: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const vaultActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export interface SecretBinding {
  consumerType: string
  consumerId: string
  field: string
  label: string
}

/** Immutable version metadata. Encrypted payloads never cross this boundary. */
export interface VaultVersionMeta {
  version: number
  reason: string
  createdAt: number
  redactedAt?: number
}

/** Value-free activity entry. Request payloads, headers and secret fields are excluded. */
export interface VaultAuditEntry {
  id: number
  itemId: string | null
  key: string | null
  label: string | null
  actorType: string
  actorId: string
  consumerType?: string
  consumerId?: string
  operation: string
  result: string
  createdAt: number
}

/** Client-facing metadata — NEVER carries the value. */
export interface SecretMeta {
  id: string
  key: string
  label: string
  type: VaultItemType
  source: VaultItemSource
  backend: string
  version: number
  description?: string
  tags: string[]
  /** Only user/plugin aliases can be embedded in configs. Managed items stay opaque. */
  reference: string | null
  createdAt: number
  updatedAt: number
}

export function isSecretHandle(value: string): boolean {
  return value.startsWith(SECRET_PREFIX)
}

/** The key inside a `secret:<KEY>` handle, or null when it isn't a handle. */
export function secretHandleKey(value: string): string | null {
  return isSecretHandle(value) ? value.slice(SECRET_PREFIX.length) : null
}

export function toSecretHandle(key: string): string {
  return `${SECRET_PREFIX}${key}`
}
