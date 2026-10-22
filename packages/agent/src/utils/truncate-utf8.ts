// UTF-8 sizes of JavaScript strings, and cutting a string to a byte budget from its end, without a
// Node-only dependency.

interface ByteCounter {
  byteLength(content: string, encoding: 'utf8'): number
}

const nodeBuffer = (globalThis as { Buffer?: ByteCounter }).Buffer
const encoder = new TextEncoder()
const REPLACEMENT = String.fromCharCode(0xfffd)

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

/**
 * UTF-8 byte length of a string: Buffer's count where there is one, the encoder's otherwise. Both
 * count an unpaired surrogate as the three bytes of the U+FFFD it is encoded as.
 */
export function utf8ByteLength(content: string): number {
  return nodeBuffer ? nodeBuffer.byteLength(content, 'utf8') : encoder.encode(content).length
}

/** Bytes of the one UTF-16 unit `unit` when it is not half of a surrogate pair. */
const singleUnitBytes = (unit: number) => (unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3)

/** The string with each surrogate that has no partner swapped for U+FFFD. */
function wellFormed(text: string): string {
  const parts: string[] = []
  let from = 0
  for (let at = 0; at < text.length; at++) {
    const unit = text.charCodeAt(at)
    if (isHighSurrogate(unit) && at + 1 < text.length && isLowSurrogate(text.charCodeAt(at + 1))) {
      at++
      continue
    }
    if (isHighSurrogate(unit) || isLowSurrogate(unit)) {
      parts.push(text.slice(from, at), REPLACEMENT)
      from = at + 1
    }
  }
  parts.push(text.slice(from))
  return parts.join('')
}

/**
 * Truncate a string to fit within a byte limit, keeping the END. Never splits a surrogate pair or
 * the bytes of one character; an unpaired surrogate in what is kept becomes U+FFFD.
 */
export function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let budget = maxBytes
  let start = str.length
  let unpaired = false
  while (start > 0) {
    const unit = str.charCodeAt(start - 1)
    const pair = isLowSurrogate(unit) && start > 1 && isHighSurrogate(str.charCodeAt(start - 2))
    const cost = pair ? 4 : singleUnitBytes(unit)
    if (cost > budget) break
    budget -= cost
    start -= pair ? 2 : 1
    if (!pair && (isHighSurrogate(unit) || isLowSurrogate(unit))) unpaired = true
  }
  const kept = str.slice(start)
  return unpaired ? wellFormed(kept) : kept
}
