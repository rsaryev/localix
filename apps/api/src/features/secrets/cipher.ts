import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * At-rest cipher for secret values — a seam so the storage format can move from
 * plaintext to authenticated encryption (or an OS keychain) without touching the
 * store/service. A cipher turns a plaintext value into an opaque token and back.
 */
export interface SecretCipher {
  encrypt(plain: string, context?: string): string
  decrypt(token: string, context?: string): string
}

/** No-op cipher: value stored as-is (behind a 0600 file). Parity floor; used in tests. */
export const plaintextCipher: SecretCipher = {
  encrypt: (plain) => plain,
  decrypt: (token) => token,
}

const IV_LEN = 12
const TAG_LEN = 16
const V2_PREFIX = 'v2.'

/**
 * AES-256-GCM with a 32-byte master key.
 *
 * v2 tokens authenticate the owning user/item as Additional Authenticated Data:
 * moving a valid ciphertext to another key, user, or future namespace no longer
 * decrypts. Legacy unprefixed tokens remain readable so existing vaults migrate
 * lazily on the next intentional rotation instead of becoming unavailable.
 */
export function createAesCipher(masterKey: Buffer): SecretCipher {
  if (masterKey.length !== 32) throw new Error('AES master key must be 32 bytes')
  return {
    encrypt(plain, context = '') {
      const iv = randomBytes(IV_LEN)
      const c = createCipheriv('aes-256-gcm', masterKey, iv)
      c.setAAD(Buffer.from(context, 'utf8'))
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return `${V2_PREFIX}${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`
    },
    decrypt(token, context = '') {
      const isV2 = token.startsWith(V2_PREFIX)
      const encoded = isV2 ? token.slice(V2_PREFIX.length) : token
      const buf = Buffer.from(encoded, 'base64')
      if (buf.length < IV_LEN + TAG_LEN) throw new Error('Malformed encrypted secret')
      const iv = buf.subarray(0, IV_LEN)
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
      const ct = buf.subarray(IV_LEN + TAG_LEN)
      const d = createDecipheriv('aes-256-gcm', masterKey, iv)
      if (isV2) d.setAAD(Buffer.from(context, 'utf8'))
      d.setAuthTag(tag)
      return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
    },
  }
}
