import {
  marketplaceSignatureState,
  type MarketplaceSignatures,
  type MarketplaceSignatureState,
} from '@localixai/mini-app-sdk/marketplace-signature'

/**
 * WHAT A MARKETPLACE'S SIGNATURES ARE WORTH (`docs/extending/mini-app-marketplace.md`, "Signing",
 * "Rotating a key", "Rollback"), as pure policy: whether a read is signed by a key Localix keeps
 * for it, what to keep from now on, and whether the read is refused as older than one already
 * read. `marketplaces.ts` stores what is kept; `store-offers.ts` asks this for every read.
 */

/** What Localix keeps for one marketplace between reads. */
export interface KeptTrust {
  /** The keys its next release must be signed by; empty, it is not signed. */
  keys: string[]
  /** The newest release read (ISO 8601): an older one is refused. */
  published?: string
  /** For a marketplace Localix ships keys for: the shipped keys these were kept from. */
  root?: string[]
}

export interface TrustVerdict {
  state: MarketplaceSignatureState
  /** Why the read is refused; its apps are not offered. */
  refused?: string
  /** What to keep from now on; absent when it did not change. */
  keep?: KeptTrust
}

const sameSet = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((key) => b.includes(key))
const time = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NaN)
const later = (a: string | undefined, b: string | undefined) =>
  !a ? b : !b ? a : time(b) > time(a) ? b : a

export function judgeMarketplace(input: {
  /** The keys whose signatures hold for the bytes read; null with no signature file. */
  signatures: MarketplaceSignatures | null
  /** The release's `published`. */
  published?: string
  /** The release's `signingKeys`: the keys of the next one. */
  signingKeys?: string[]
  kept: KeptTrust | undefined
  /** The keys Localix ships for a built-in marketplace. */
  pinned?: readonly string[]
  /** Whether a first signed read is trusted on its own: one the person added, or one linked to. */
  firstUse: boolean
}): TrustVerdict {
  const { signatures, published, signingKeys, pinned, firstUse } = input
  // Keys kept from shipped keys Localix no longer ships are dropped: a leaked key goes with a
  // release that ships new ones.
  const kept =
    pinned && input.kept && !sameSet(input.kept.root, pinned)
      ? { keys: [], published: input.kept.published }
      : input.kept
  const known = kept?.keys.length ? kept.keys : [...(pinned ?? [])]
  const valid = signatures && 'keys' in signatures ? signatures.keys : []
  const state: MarketplaceSignatureState = known.length
    ? marketplaceSignatureState(signatures ?? { keys: [] }, known)
    : firstUse && valid.length
      ? 'signed'
      : 'unsigned'
  if (state === 'mismatch') return { state }

  if (kept?.published && !(time(published) >= time(kept.published)))
    return { state, refused: `an older release than the one already read (${kept.published})` }

  const keys =
    state === 'signed' ? (signingKeys?.length ? signingKeys : known.length ? known : valid) : []
  const next: KeptTrust = {
    keys,
    ...(later(kept?.published, published) ? { published: later(kept?.published, published) } : {}),
    ...(pinned ? { root: [...pinned] } : {}),
  }
  const unchanged =
    kept &&
    sameSet(kept.keys, next.keys) &&
    kept.published === next.published &&
    (!pinned || sameSet(kept.root, pinned))
  return unchanged ? { state } : { state, keep: next }
}
