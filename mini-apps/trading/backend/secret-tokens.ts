/**
 * `${secret:KEY}` resolution for exchange credentials.
 *
 * The token grammar + substitution are NOT reimplemented here: the pure leaf
 * `@localixai/mini-app-sdk/backend` (`hasSecretTokens` / `resolveSecretTokens`) is the one
 * source of truth for the whole app, and the database workbench reuses it the same way. Only
 * the *shape* of what gets interpolated is mini-app-specific — for trading that is each field
 * of the credential map, rather than a connection URL.
 *
 * The vault itself is never imported: a resolver arrives through the generic mini app host seam
 * (`ctx.host.resolveSecret`) and is threaded in by the service.
 */
import { hasSecretTokens, resolveSecretTokens } from '@localixai/mini-app-sdk/backend'
import type { CredentialField, TradingConnectionConfig, TradingCredentials } from './contracts'
import { CREDENTIAL_FIELDS } from './contracts'
import { TradingError } from './errors'

/** Resolve one secret key for a user; `null` when absent or the vault is unavailable. */
export type ResolveSecret = (userId: string, key: string) => Promise<string | null>

/**
 * Store one value under `key` — ONLY when the key is free (`false` = taken, nothing written).
 * The create-only half of the vault (`setIfAbsent`, never `set`): it lets a pasted literal
 * credential move into the vault as a `${secret:KEY}` reference without granting this mini app
 * the power to overwrite a key another integration depends on.
 */
export type StoreSecret = (userId: string, key: string, value: string) => Promise<boolean>

/**
 * Return a copy of `config` with every `${secret:KEY}` inside a credential replaced by its
 * vault value. Only the live driver ever sees resolved credentials — the persisted config
 * keeps the tokens.
 *
 * A referenced-but-missing secret is a HARD error: signing an order with the literal token
 * text would fail at the venue as an opaque signature error, long after the real cause.
 */
export async function resolveConfigSecrets(
  userId: string,
  config: TradingConnectionConfig,
  resolve: ResolveSecret | undefined,
): Promise<TradingConnectionConfig> {
  const creds = config.credentials
  if (!creds) return config

  const resolved: TradingCredentials = { ...creds }
  const fields: CredentialField[] = []
  for (const field of CREDENTIAL_FIELDS) {
    const value = creds[field]
    if (!value || !hasSecretTokens(value)) continue
    if (!resolve) {
      throw new TradingError(
        'auth_failed',
        `Credential "${field}" references a secret, but the secrets store is unavailable.`,
      )
    }
    fields.push(field)
  }
  if (fields.length === 0) return config

  const results = await Promise.allSettled(
    fields.map((field) => resolveSecretTokens(creds[field]!, (key) => resolve!(userId, key))),
  )
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    const result = results[index]
    if (result.status === 'rejected') {
      throw new TradingError(
        'auth_failed',
        `Credential "${field}": ${(result.reason as Error).message}`,
        { cause: result.reason },
      )
    }
    resolved[field] = result.value
  }
  return { ...config, credentials: resolved }
}

/** Which credential fields carry a value — the only credential fact a client ever sees. */
export function credentialFields(config: TradingConnectionConfig): CredentialField[] {
  const creds = config.credentials
  if (!creds) return []
  return CREDENTIAL_FIELDS.filter((f) => Boolean(creds[f]))
}
