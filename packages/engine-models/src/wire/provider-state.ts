/**
 * PROVIDER STATE that must ride back with a message: a reasoning block's signature, an encrypted
 * reasoning item, an output item id, a thought signature. Opaque to everyone but the provider
 * that issued it, and refused or silently dropped if it does not come back verbatim.
 *
 * The host already carries one opaque string per part for exactly this (`textSignature`,
 * `thinkingSignature`, `thoughtSignature`) through events, items and history, and never reads
 * it. The provider SDK speaks `providerMetadata` out and `providerOptions` back in, so the state
 * travels as `aisdk:` + that metadata's JSON — nothing for the host to learn. Signatures written
 * by the previous engine are translated where their shape is known, and otherwise left out.
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

/** The part a stored signature belongs to, which decides how an old one is read. */
export type StatePart = 'text' | 'reasoning' | 'tool-call'

/**
 * The provider options to send a part back with. `api` is the wire the part was produced over
 * (the stored message's `api`), used only to read a signature the previous engine wrote.
 */
export function decodeProviderState(
  signature: string | undefined,
  part: StatePart,
  api: string | undefined,
  options: { redacted?: boolean } = {},
): SharedV4ProviderOptions | undefined {
  if (!signature) return undefined
  if (signature.startsWith(PREFIX)) {
    try {
      return JSON.parse(signature.slice(PREFIX.length)) as SharedV4ProviderOptions
    } catch {
      return undefined
    }
  }
  return legacyState(signature, part, api, options.redacted === true)
}

/** Signatures the previous engine wrote, per wire. Anything unrecognised is dropped. */
function legacyState(
  signature: string,
  part: StatePart,
  api: string | undefined,
  redacted: boolean,
): SharedV4ProviderOptions | undefined {
  if (api === 'anthropic-messages' && part === 'reasoning') {
    return { anthropic: redacted ? { redactedData: signature } : { signature } }
  }
  if (api?.startsWith('google')) return { google: { thoughtSignature: signature } }
  if (
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'azure-openai-responses'
  ) {
    if (part === 'reasoning') {
      try {
        const item = JSON.parse(signature) as { id?: unknown; encrypted_content?: unknown }
        if (typeof item.id !== 'string') return undefined
        return {
          openai: {
            itemId: item.id,
            ...(typeof item.encrypted_content === 'string'
              ? { reasoningEncryptedContent: item.encrypted_content }
              : {}),
          },
        }
      } catch {
        return undefined
      }
    }
    if (part === 'text') {
      const itemId = legacyTextItemId(signature)
      return itemId ? { openai: { itemId } } : undefined
    }
  }
  return undefined
}

/** The previous engine wrote an output item id either bare or as `{"v":1,"id":…}`. */
function legacyTextItemId(signature: string): string | undefined {
  if (!signature.startsWith('{')) return signature.startsWith('msg_') ? signature : undefined
  try {
    const parsed = JSON.parse(signature) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : undefined
  } catch {
    return undefined
  }
}
