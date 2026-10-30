import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

/**
 * A RELEASED MARKETPLACE'S SIGNATURES (`docs/extending/mini-app-marketplace.md`, "Signing"):
 * `<file>.sig` beside it, Ed25519 signatures of the file's exact bytes, each naming its key:
 *
 *     { "schema": 2, "signatures": [{ "algorithm": "ed25519", "key": "<base64>", "signature": "<base64>" }] }
 *
 * Several signatures let a keeper move to a new key without a gap; a signature of an algorithm
 * this Localix does not know is passed over, so another can be added beside Ed25519 later. A
 * signature proves who signed only against keys kept from before: `marketplaceSignatureState`.
 */
export const MARKETPLACE_SIGNATURE_SCHEMA = 2
const RAW_KEY_BYTES = 32
const SIGNATURE_BYTES = 64

/** The keys whose signatures hold for the bytes, or why the file could not be read. */
export type MarketplaceSignatures = { keys: string[] } | { problem: string }

/** What a marketplace's signatures mean for the apps it lists: only `signed` updates on its own. */
export type MarketplaceSignatureState = 'signed' | 'unsigned' | 'mismatch'

const base64 = (text: unknown, bytes: number): Buffer | null => {
  if (typeof text !== 'string') return null
  const decoded = Buffer.from(text, 'base64')
  return decoded.length === bytes && decoded.toString('base64') === text ? decoded : null
}

const publicKeyFromRaw = (raw: Buffer): KeyObject =>
  createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  })

const privateKeyOf = (key: KeyObject | string): KeyObject =>
  typeof key === 'string' ? createPrivateKey(key) : key

/** The public key (32 bytes, base64) of an Ed25519 private key, a `KeyObject` or PEM. */
export function publicKeyOf(privateKey: KeyObject | string): string {
  const jwk = createPublicKey(privateKeyOf(privateKey)).export({ format: 'jwk' })
  return Buffer.from(jwk.x!, 'base64url').toString('base64')
}

/** The signature file for `bytes`, one Ed25519 signature per private key, in order. */
export function signMarketplace(
  bytes: Uint8Array,
  privateKeys: readonly (KeyObject | string)[],
): string {
  const signatures = privateKeys.map((key) => ({
    algorithm: 'ed25519',
    key: publicKeyOf(key),
    signature: sign(null, bytes, privateKeyOf(key)).toString('base64'),
  }))
  return `${JSON.stringify({ schema: MARKETPLACE_SIGNATURE_SCHEMA, signatures })}\n`
}

/** The keys whose signatures in `text`, a signature file, hold for `bytes`. */
export function verifyMarketplaceSignature(bytes: Uint8Array, text: string): MarketplaceSignatures {
  let parsed: { schema?: unknown; signatures?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    return { problem: 'the signature file is not JSON' }
  }
  if (parsed?.schema !== MARKETPLACE_SIGNATURE_SCHEMA || !Array.isArray(parsed.signatures))
    return {
      problem: `the signature file is not a schema ${MARKETPLACE_SIGNATURE_SCHEMA} marketplace signature`,
    }
  const keys = parsed.signatures.flatMap((entry: Record<string, unknown> | null) => {
    if (entry?.algorithm !== 'ed25519') return []
    const key = base64(entry.key, RAW_KEY_BYTES)
    const signature = base64(entry.signature, SIGNATURE_BYTES)
    if (!key || !signature) return []
    return verify(null, bytes, publicKeyFromRaw(key), signature) ? [key.toString('base64')] : []
  })
  return { keys: [...new Set(keys)] }
}

/**
 * What the signatures mean against the keys Localix keeps for the marketplace: signed by one of
 * them, or `mismatch` — signed by none of them, not signed, or unreadable. With no key kept, the
 * marketplace is `unsigned`, whatever is beside it.
 */
export function marketplaceSignatureState(
  read: MarketplaceSignatures,
  kept: readonly string[],
): MarketplaceSignatureState {
  if (!kept.length) return 'unsigned'
  return 'keys' in read && read.keys.some((key) => kept.includes(key)) ? 'signed' : 'mismatch'
}
