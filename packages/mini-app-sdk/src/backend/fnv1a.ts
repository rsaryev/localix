/**
 * FNV-1a (32-bit) — the revision/fingerprint hash, owned once.
 *
 * Modules had independently open-coded the same loop with the same seed and the same prime,
 * to answer the same question: "is this the same content as last time?" (the resource-context
 * provider's content and cache revisions). Identical bytes in, identical digest out — so
 * consolidating them costs ZERO revision churn: no cache is invalidated,
 * no persisted revision string changes.
 *
 * NOT A SECURITY HASH. FNV-1a is a fast, non-cryptographic digest with real collision
 * probability at 32 bits. It is used to detect that content CHANGED (a stale-cache /
 * stale-snapshot check), never to prove that content is AUTHENTIC. Do not reach for it
 * to sign, authenticate, or deduplicate anything an adversary chooses the input to.
 *
 * Hashes UTF-16 code units (`charCodeAt`), not UTF-8 bytes. That is a deliberate
 * carry-over from the callers it replaced: changing it would rewrite every revision
 * string in flight for no benefit. Callers that need a byte length compute it separately.
 */

const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193

/** The 32-bit FNV-1a digest of `input`, as an unsigned integer. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), FNV_PRIME_32)
  }
  return hash >>> 0
}

/** The 32-bit FNV-1a digest of `input`, lower-case hex — the form every caller wanted. */
export function fnv1aHex(input: string): string {
  return fnv1a32(input).toString(16)
}
