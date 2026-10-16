import { assetBindings, type MessageAttachment, type MessageBinding } from '@localixai/agent'

/**
 * What a send's bindings cost on the wire, and the cap that cost must stay under.
 *
 * Its own module because the rule has two readers that must never disagree — the request
 * schema that refuses an oversized send, and `bootstrap.ts`, which sizes the realtime
 * socket's `maxPayloadLength` above it.
 */

/**
 * Exported because the realtime WebSocket's `maxPayloadLength` (index.ts) must
 * stay ABOVE this: a `{t:'send'}` frame carries base64 asset bindings inline,
 * and Bun CLOSES a socket that receives a frame over its payload cap — which
 * would kill the tab's whole multiplexed firehose on a legitimate send.
 */
export const MAX_MESSAGE_BINDINGS_TOTAL_BYTES = 25 * 1024 * 1024

/** One attachment's contribution, wherever it hangs: top level, or nested under a context. */
function attachmentBytes(attachment: MessageAttachment): number {
  // A path attachment carries no file CONTENT in the frame, so it contributes zero to this
  // content-byte cap. It still counts toward the 20-binding limit, and its path itself is
  // independently bounded to 4096 characters by the schema.
  if (attachment.kind === 'path') return 0
  const body = attachment.kind === 'text' ? attachment.text : (attachment.data ?? '')
  return Buffer.byteLength(body, 'utf8')
}

/**
 * The frame cost of a send's bindings, in UTF-8 BYTES — the unit the limit is named in and
 * the only unit the socket cares about.
 *
 * This used to sum `.length`, which counts UTF-16 code units. For `data` (base64, pure ASCII)
 * the two agree, which is why it went unnoticed; for a `text` attachment they do not. Many
 * scripts use 2–3 UTF-8 bytes per code unit, so 25M two-byte code units is a 50MB frame that
 * passed a 25MB check — and the ×2 headroom on `maxPayloadLength` was sized for JSON/prompt
 * overhead, not for a 2x unit error, so the frame lands at or over Bun's cap. Bun then CLOSES
 * the socket, killing the tab's whole multiplexed firehose: exactly the failure this limit and
 * that headroom exist to prevent, reachable through a contract-VALID send.
 *
 * `byteLength` for every kind, not just `text`: one rule beats a per-kind exception a reader
 * has to re-derive.
 */
export function bindingsTotalBytes(bindings: readonly MessageBinding[]): number {
  const topLevelBytes = bindings.reduce((sum, binding) => {
    if (binding.kind === 'context') {
      return (
        sum +
        binding.resolution.contributions.reduce(
          (total, contribution) => total + Buffer.byteLength(contribution.content, 'utf8'),
          0,
        )
      )
    }
    if (binding.kind === 'invocation') {
      return sum + Buffer.byteLength(binding.instruction ?? '', 'utf8')
    }
    return sum + attachmentBytes(binding)
  }, 0)
  // An asset hanging off a context binding is content on the same wire, so it is charged the
  // same way; `assetBindings` also returns the top-level ones, already counted above.
  const nestedAssetBytes = assetBindings(bindings)
    .filter((asset) => !bindings.includes(asset))
    .reduce((sum, asset) => sum + attachmentBytes(asset), 0)
  return topLevelBytes + nestedAssetBytes
}
