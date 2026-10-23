import { describe, expect, it } from 'bun:test'
import {
  deriveSecretKey,
  deriveSecretKeyFromHost,
  deriveSshSecretKey,
  deriveTlsSecretKey,
  extractUrlPassword,
  isSecretToken,
  secretToken,
} from './connectionSecret'

describe('extractUrlPassword', () => {
  it('extracts a password and tokenizes the URL', () => {
    const r = extractUrlPassword('postgres://app:s3cret@db.internal:5432/app')
    expect(r?.password).toBe('s3cret')
    expect(r?.toToken('DB_PW')).toBe('postgres://app:${secret:DB_PW}@db.internal:5432/app')
  })

  it('vaults an unescaped at-sign as part of the password', () => {
    const r = extractUrlPassword('postgres://app:p@ss@db.internal:5432/app')

    expect(r?.password).toBe('p@ss')
    expect(r?.toToken('DB_PW')).toBe('postgres://app:${secret:DB_PW}@db.internal:5432/app')
  })

  it('returns null when there is no password', () => {
    expect(extractUrlPassword('postgres://app@host/db')).toBeNull()
    expect(extractUrlPassword('mysql://host/db')).toBeNull()
    expect(extractUrlPassword('postgres://app:@host/db')).toBeNull()
  })

  it('leaves an already-tokenized URL alone (token is not a bare password)', () => {
    // A `${secret:...}` contains no bare password to re-extract into a nested secret.
    const r = extractUrlPassword('postgres://app:${secret:DB_PW}@host/db')
    expect(r?.password).toBe('${secret:DB_PW}')
    // Re-tokenizing is idempotent-ish; callers guard by checking for an existing token first.
  })
})

describe('deriveSecretKey', () => {
  it('derives a schema-valid key from the host', () => {
    expect(deriveSecretKey('postgres://app:pw@db.internal:5432/app')).toBe('DB_DB_INTERNAL_PW')
    expect(deriveSecretKey('mysql://u:p@localhost/x')).toBe('DB_LOCALHOST_PW')
    expect(/^[A-Za-z0-9_.-]+$/.test(deriveSecretKey('postgres://u:p@db.internal/x'))).toBe(true)
  })
})

describe('field-mode secret helpers', () => {
  it('derives the same key from a host as the URL helper does', () => {
    expect(deriveSecretKeyFromHost('db.internal')).toBe('DB_DB_INTERNAL_PW')
    expect(deriveSecretKeyFromHost('localhost')).toBe('DB_LOCALHOST_PW')
    expect(deriveSecretKeyFromHost('')).toBe('DB_PW')
    // Parity with the URL-derived key for the same host.
    expect(deriveSecretKeyFromHost('db.internal')).toBe(
      deriveSecretKey('postgres://u:p@db.internal/x'),
    )
  })

  it('builds a token and recognizes one', () => {
    expect(secretToken('DB_LOCALHOST_PW')).toBe('${secret:DB_LOCALHOST_PW}')
    expect(isSecretToken('${secret:DB_LOCALHOST_PW}')).toBe(true)
    expect(isSecretToken('  ${secret:X}  ')).toBe(true)
    expect(isSecretToken('root')).toBe(false)
    expect(isSecretToken('pre${secret:X}post')).toBe(false)
  })
})

describe('SSH credential vaulting helpers', () => {
  it('deriveSshSecretKey derives a schema-valid key from the bastion host + kind', () => {
    expect(deriveSshSecretKey('bastion.internal', 'pw')).toBe('SSH_BASTION_INTERNAL_PW')
    expect(deriveSshSecretKey('bastion.internal', 'passphrase')).toBe(
      'SSH_BASTION_INTERNAL_PASSPHRASE',
    )
    expect(deriveSshSecretKey('bastion.internal', 'private-key')).toBe(
      'SSH_BASTION_INTERNAL_PRIVATE_KEY',
    )
    expect(deriveSshSecretKey('', 'pw')).toBe('SSH_PW')
    expect(/^[A-Za-z0-9_.-]+$/.test(deriveSshSecretKey('10.0.0.5', 'pw'))).toBe(true)
  })
})

describe('TLS credential vaulting helpers', () => {
  it('derives a schema-valid private-key secret from the database host', () => {
    expect(deriveTlsSecretKey('db.internal')).toBe('DB_DB_INTERNAL_TLS_PRIVATE_KEY')
    expect(deriveTlsSecretKey('')).toBe('DB_TLS_PRIVATE_KEY')
    expect(/^[A-Za-z0-9_.-]+$/.test(deriveTlsSecretKey('10.0.0.5'))).toBe(true)
  })
})
