/**
 * Pure helpers for moving a connection URL's password into the central secrets store.
 * A tokenized URL keeps the credential out of the saved config — the server fills the
 * `${secret:KEY}` token in at connect time.
 */
import { splitConnectionUrlPassword } from '../../shared/connection-url'

export interface UrlPassword {
  /** The raw password found between `user:` and `@`. */
  password: string
  /** Rebuild the URL with the password replaced by a `${secret:KEY}` token. */
  toToken: (key: string) => string
}

/** Extract the inline password from a connection URL, or null if it has none. */
export function extractUrlPassword(url: string): UrlPassword | null {
  const parts = splitConnectionUrlPassword(url)
  if (!parts?.password) return null
  return {
    password: parts.password,
    toToken: (key) => `${parts.head}:\${secret:${key}}@${parts.tail}`,
  }
}

/** Derive a stable, schema-valid secret key from a URL's host (e.g. `DB_DB_INTERNAL_PW`). */
export function deriveSecretKey(url: string): string {
  const parts = splitConnectionUrlPassword(url)
  const host = parts ? parts.tail.split(/[/:?#]/)[0] : ''
  return deriveSecretKeyFromHost(host)
}

/** The `${secret:KEY}` token shape (matches the server-side interpolation pattern). */
const SECRET_TOKEN_RE = /^\$\{secret:[A-Za-z0-9_.-]+\}$/

/** True when a value is already a `${secret:KEY}` token (so we don't re-vault it). */
export function isSecretToken(value: string): boolean {
  return SECRET_TOKEN_RE.test(value.trim())
}

/** `db.internal:5432` → `DB_INTERNAL_5432`: the host part every derived secret key shares. */
function hostSlug(host: string): string {
  return host
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

/** Derive a stable, schema-valid secret key directly from a host (field mode — there is no
 *  URL to parse). Mirrors {@link deriveSecretKey}'s output for the same host. */
export function deriveSecretKeyFromHost(host: string): string {
  const slug = hostSlug(host)
  return slug ? `DB_${slug}_PW` : 'DB_PW'
}

/** Build the `${secret:KEY}` token that replaces a raw password / SSH credential. */
export function secretToken(key: string): string {
  return `\${secret:${key}}`
}

/** Derive a stable, schema-valid secret key for an SSH credential from the bastion host
 *  (e.g. `SSH_BASTION_INTERNAL_PW` / `SSH_BASTION_INTERNAL_PRIVATE_KEY`). */
export function deriveSshSecretKey(
  host: string,
  kind: 'pw' | 'private-key' | 'passphrase',
): string {
  const slug = hostSlug(host)
  const suffix = kind === 'pw' ? 'PW' : kind === 'private-key' ? 'PRIVATE_KEY' : 'PASSPHRASE'
  return slug ? `SSH_${slug}_${suffix}` : `SSH_${suffix}`
}

/** Stable Vault key for a database TLS client private key. */
export function deriveTlsSecretKey(host: string): string {
  const slug = hostSlug(host)
  return slug ? `DB_${slug}_TLS_PRIVATE_KEY` : 'DB_TLS_PRIVATE_KEY'
}
