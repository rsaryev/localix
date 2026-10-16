/** A binary value either before transport (Uint8Array/Buffer) or after JSON transport. */
export type BinaryBytes = Uint8Array | readonly number[]

/**
 * Recognize the two binary shapes database results can use. Hono JSON serialization calls
 * Buffer.toJSON(), so browser code sees `{ type: "Buffer", data: [...] }`. Validate every
 * byte before treating an arbitrary JSON document as binary.
 */
export function binaryBytes(value: unknown): BinaryBytes | null {
  if (value instanceof Uint8Array) return value
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { type?: unknown; data?: unknown }
  if (candidate.type !== 'Buffer' || !Array.isArray(candidate.data)) return null
  return candidate.data.every(
    (byte): byte is number => Number.isInteger(byte) && byte >= 0 && byte <= 0xff,
  )
    ? candidate.data
    : null
}

export function binaryHex(value: unknown): string | null {
  const bytes = binaryBytes(value)
  if (!bytes) return null
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
