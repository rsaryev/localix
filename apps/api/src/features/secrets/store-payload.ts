import type { SecretCipher } from './cipher'

export interface EncryptedPayloadV1 {
  schema: 1
  fields: Record<string, string>
}

export class VaultPayloadError extends Error {
  readonly itemId: string
  readonly code: 'corrupt' | 'unavailable'

  constructor(itemId: string, code: 'corrupt' | 'unavailable') {
    super(
      code === 'corrupt'
        ? 'Vault item cannot be decrypted'
        : 'Vault item storage backend is unavailable',
    )
    this.itemId = itemId
    this.code = code
    this.name = 'VaultPayloadError'
  }
}

export const payloadContext = (userId: string, itemId: string, version: number) =>
  `localix-vault:v1:${userId}:${itemId}:${version}`

export const decryptItemValue = (
  cipher: SecretCipher,
  userId: string,
  itemId: string,
  version: number,
  field: string,
  encryptedPayload: string,
): string | null => {
  const plain = cipher.decrypt(encryptedPayload, payloadContext(userId, itemId, version))
  const payload = JSON.parse(plain) as Partial<EncryptedPayloadV1>
  const value = payload.schema === 1 ? payload.fields?.[field] : undefined
  return typeof value === 'string' ? value : null
}
