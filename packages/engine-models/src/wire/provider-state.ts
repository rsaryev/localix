/**
 * PROVIDER STATE that must ride back with a message: a reasoning block's signature, an encrypted
 * reasoning item, an output item id, a thought signature. Opaque to everyone but the provider
 * that issued it, and refused or silently dropped if it does not come back verbatim.
 *
 * The host already carries one opaque string per part for exactly this (`textSignature`,
 * `thinkingSignature`, `thoughtSignature`) through events, items and history, and never reads
 * it. The provider SDK speaks `providerMetadata` out and `providerOptions` back in, so the state
 * travels as `aisdk:` + that metadata's JSON — nothing for the host to learn.  A signature without that prefix is left out.
 */
import type { SharedV4ProviderMetadata, SharedV4ProviderOptions } from '@ai-sdk/provider'

const PREFIX = 'aisdk:'

/** The metadata a part streamed with, as the string the host keeps. Undefined when there is none. */
export function encodeProviderState(
  metadata: SharedV4ProviderMetadata | undefined,
): string | undefined {
  if (!metadata) return undefined
  const kept = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value && Object.keys(value).length > 0),
  )
  return Object.keys(kept).length > 0 ? `${PREFIX}${JSON.stringify(kept)}` : undefined
}

/** Metadata from a part's start, deltas and end, as one: later keys win within a provider. */
export function mergeMetadata(
  a: SharedV4ProviderMetadata | undefined,
  b: SharedV4ProviderMetadata | undefined,
): SharedV4ProviderMetadata | undefined {
  if (!a) return b
  if (!b) return a
  const merged: SharedV4ProviderMetadata = { ...a }
  for (const [key, value] of Object.entries(b)) merged[key] = { ...a[key], ...value }
  return merged
}

/** The provider options to send a part back with, or undefined when the signature is not ours. */
export function decodeProviderState(
  signature: string | undefined,
): SharedV4ProviderOptions | undefined {
  if (!signature?.startsWith(PREFIX)) return undefined
  try {
    return JSON.parse(signature.slice(PREFIX.length)) as SharedV4ProviderOptions
  } catch {
    return undefined
  }
}
