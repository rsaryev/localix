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

/**
 * Stable Localix item kinds. This is intentionally a string vocabulary rather than
 * a database enum: external backends (1Password, Infisical, OS keychains) can map
 * their richer categories onto it without a storage migration for every new kind.
 */
export const VAULT_ITEM_TYPES = [
  'secret',
  'password',
  'api_key',
  'oauth',
  'login',
  'database',
  'server',
  'ssh_key',
  'certificate',
  'totp',
  'recovery_codes',
  'crypto_wallet',
  'bank_account',
  'credit_card',
  'identity',
  'passport',
  'driver_license',
  'social_security_number',
  'email_account',
  'document',
  'medical_record',
  'membership',
  'outdoor_license',
  'reward_program',
  'software_license',
  'wireless_router',
  'secure_note',
] as const

export const vaultItemTypeSchema = z.enum(VAULT_ITEM_TYPES)
export type VaultItemType = z.infer<typeof vaultItemTypeSchema>

export type VaultItemGroup = 'developer' | 'access' | 'finance' | 'identity' | 'personal'

export interface VaultItemTypeDefinition {
  label: string
  group: VaultItemGroup
  valueLabel: string
  valuePlaceholder: string
  highImpact?: boolean
}

/**
 * One canonical category registry shared by HTTP contracts, agent tools and the UI.
 * Categories follow 1Password's durable item vocabulary where it fits Localix, with
 * developer-specific credentials kept first-class. The encrypted payload is already
 * a field map, so richer per-category fields can be added without changing item identity.
 */
export const VAULT_ITEM_TYPE_DEFINITIONS: Record<VaultItemType, VaultItemTypeDefinition> = {
  secret: {
    label: 'Generic secret',
    group: 'developer',
    valueLabel: 'Secret value',
    valuePlaceholder: 'Paste secret value',
  },
  password: {
    label: 'Password',
    group: 'access',
    valueLabel: 'Password',
    valuePlaceholder: 'Enter password',
  },
  api_key: {
    label: 'API credential',
    group: 'developer',
    valueLabel: 'API key or token',
    valuePlaceholder: 'Paste API credential',
  },
  oauth: {
    label: 'OAuth credential',
    group: 'developer',
    valueLabel: 'Token payload',
    valuePlaceholder: 'Paste token or encrypted token bundle',
  },
  login: {
    label: 'Login',
    group: 'access',
    valueLabel: 'Password',
    valuePlaceholder: 'Enter account password',
  },
  database: {
    label: 'Database credential',
    group: 'developer',
    valueLabel: 'Password or connection secret',
    valuePlaceholder: 'Paste database credential',
  },
  server: {
    label: 'Server',
    group: 'developer',
    valueLabel: 'Server credential',
    valuePlaceholder: 'Paste server credential',
  },
  ssh_key: {
    label: 'SSH key',
    group: 'developer',
    valueLabel: 'Private key',
    valuePlaceholder: 'Paste private key',
    highImpact: true,
  },
  certificate: {
    label: 'Certificate',
    group: 'developer',
    valueLabel: 'Private key or certificate bundle',
    valuePlaceholder: 'Paste PEM or certificate bundle',
    highImpact: true,
  },
  totp: {
    label: 'One-time password',
    group: 'access',
    valueLabel: 'TOTP secret or URI',
    valuePlaceholder: 'Paste otpauth:// URI or seed',
  },
  recovery_codes: {
    label: 'Recovery codes',
    group: 'access',
    valueLabel: 'Recovery codes',
    valuePlaceholder: 'Paste recovery codes',
    highImpact: true,
  },
  crypto_wallet: {
    label: 'Crypto wallet',
    group: 'finance',
    valueLabel: 'Seed phrase or private key',
    valuePlaceholder: 'Enter seed phrase or private key',
    highImpact: true,
  },
  bank_account: {
    label: 'Bank account',
    group: 'finance',
    valueLabel: 'Sensitive account details',
    valuePlaceholder: 'Enter account details',
  },
  credit_card: {
    label: 'Credit card',
    group: 'finance',
    valueLabel: 'Card details',
    valuePlaceholder: 'Enter card details',
  },
  identity: {
    label: 'Identity',
    group: 'identity',
    valueLabel: 'Identity details',
    valuePlaceholder: 'Enter sensitive identity details',
  },
  passport: {
    label: 'Passport',
    group: 'identity',
    valueLabel: 'Passport details',
    valuePlaceholder: 'Enter passport details',
    highImpact: true,
  },
  driver_license: {
    label: 'Driver license',
    group: 'identity',
    valueLabel: 'License details',
    valuePlaceholder: 'Enter driver license details',
  },
  social_security_number: {
    label: 'Social security number',
    group: 'identity',
    valueLabel: 'Identifier',
    valuePlaceholder: 'Enter sensitive identifier',
    highImpact: true,
  },
  email_account: {
    label: 'Email account',
    group: 'access',
    valueLabel: 'Email password',
    valuePlaceholder: 'Enter email credential',
  },
  document: {
    label: 'Document',
    group: 'personal',
    valueLabel: 'Protected document data',
    valuePlaceholder: 'Paste protected document data',
  },
  medical_record: {
    label: 'Medical record',
    group: 'personal',
    valueLabel: 'Medical record',
    valuePlaceholder: 'Enter private medical information',
    highImpact: true,
  },
  membership: {
    label: 'Membership',
    group: 'personal',
    valueLabel: 'Membership details',
    valuePlaceholder: 'Enter membership details',
  },
  outdoor_license: {
    label: 'Outdoor license',
    group: 'personal',
    valueLabel: 'License details',
    valuePlaceholder: 'Enter license details',
  },
  reward_program: {
    label: 'Reward program',
    group: 'personal',
    valueLabel: 'Program details',
    valuePlaceholder: 'Enter reward program details',
  },
  software_license: {
    label: 'Software license',
    group: 'personal',
    valueLabel: 'License key',
    valuePlaceholder: 'Enter software license key',
  },
  wireless_router: {
    label: 'Wireless router',
    group: 'access',
    valueLabel: 'Wi-Fi password',
    valuePlaceholder: 'Enter Wi-Fi password',
  },
  secure_note: {
    label: 'Secure note',
    group: 'personal',
    valueLabel: 'Private note',
    valuePlaceholder: 'Write encrypted note',
  },
}

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

/** Compatibility name for older imports; POST semantics are now create-only. */
export const setSecretRequestSchema = createSecretRequestSchema
export type SetSecretRequest = CreateSecretRequest

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
