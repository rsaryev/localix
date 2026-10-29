import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * A catalog's signature: `<catalog>.sig` beside it, an Ed25519 signature of the catalog's exact
 * bytes and the public key that made it (`docs/extending/mini-app-publishing.md`, "Signing"):
 *
 *     { "schema": 1, "algorithm": "ed25519", "key": "<32 bytes, base64>", "signature": "<64 bytes, base64>" }
 *
 * A signature proves who signed only against a key kept from before: whoever can replace a catalog
 * can replace the file beside it. So a catalog is `signed` when its signature holds for the key
 * Localix keeps for it (pinned in code for the Localix catalog, kept when a person adds theirs).
 */
export const CATALOG_SIGNATURE_SUFFIX = '.sig'
const SIGNATURE_SCHEMA = 1
const RAW_KEY_BYTES = 32
const SIGNATURE_BYTES = 64

/** What the file beside a catalog says. */
export type CatalogSignature =
  | { state: 'unsigned' }
  | { state: 'signed'; key: string }
  | { state: 'invalid'; reason: string }

/** What a catalog's signature means for the apps it lists: only `signed` updates on its own. */
export type CatalogSignatureState = 'signed' | 'unsigned' | 'mismatch'

const base64 = (text: unknown, bytes: number): Buffer | null => {
  if (typeof text !== 'string') return null
  const decoded = Buffer.from(text, 'base64')
  return decoded.length === bytes && decoded.toString('base64') === text ? decoded : null
}

const publicKeyOf = (raw: Buffer): KeyObject =>
  createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  })

/** Whether `text`, a signature file, holds for the catalog's `bytes`. */
export function verifyCatalogSignature(bytes: Uint8Array, text: string): CatalogSignature {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text)
  } catch {
    return { state: 'invalid', reason: 'the signature file is not JSON' }
  }
  if (parsed?.schema !== SIGNATURE_SCHEMA || parsed.algorithm !== 'ed25519')
    return { state: 'invalid', reason: 'the signature file is not an Ed25519 catalog signature' }
  const key = base64(parsed.key, RAW_KEY_BYTES)
  const signature = base64(parsed.signature, SIGNATURE_BYTES)
  if (!key || !signature) return { state: 'invalid', reason: 'the signature file is malformed' }
  if (!verify(null, bytes, publicKeyOf(key), signature))
    return { state: 'invalid', reason: 'the signature does not match the catalog' }
  return { state: 'signed', key: key.toString('base64') }
}

/** The signature file for the catalog's `bytes`, made with an Ed25519 private key. */
export function signCatalog(bytes: Uint8Array, privateKey: KeyObject | string): string {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey
  const raw = Buffer.from(createPublicKey(key).export({ format: 'jwk' }).x!, 'base64url')
  return `${JSON.stringify({
    schema: SIGNATURE_SCHEMA,
    algorithm: 'ed25519',
    key: raw.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  })}\n`
}

/**
 * The signature beside the catalog read at `catalogUrl` — the address the catalog came from after
 * redirects, so both are of one release. None published is `unsigned`; one that cannot be read
 * throws, as the catalog would: a failed read says nothing about whether it is signed.
 */
export async function readCatalogSignature(
  catalogUrl: string,
  bytes: Uint8Array,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<CatalogSignature> {
  const at = `${catalogUrl}${CATALOG_SIGNATURE_SUFFIX}`
  if (at.startsWith('file:')) {
    const text = await fs.readFile(fileURLToPath(at), 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    return text === null ? { state: 'unsigned' } : verifyCatalogSignature(bytes, text)
  }
  const response = await (options.fetchImpl ?? fetch)(at, {
    signal: options.signal,
    redirect: 'follow',
  })
  if (response.status === 404) return { state: 'unsigned' }
  if (!response.ok)
    throw new Error(`The catalog signature at ${new URL(at).host} answered ${response.status}`)
  return verifyCatalogSignature(bytes, await response.text())
}

/**
 * What a catalog's signature means, given the key Localix keeps for it: signed by that key, or
 * `mismatch` — signed by another, no longer signed, or a signature that does not hold. Without a
 * kept key the catalog is `unsigned`, whatever file is beside it.
 */
export function catalogSignatureState(
  read: CatalogSignature,
  kept: string | undefined,
): CatalogSignatureState {
  if (!kept) return 'unsigned'
  if (read.state === 'invalid') return 'mismatch'
  return read.state === 'signed' && read.key === kept ? 'signed' : 'mismatch'
}
