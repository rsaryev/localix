import { isCompressedContent } from '@localixai/agent'

/** Above this, a message is content that MENTIONS a marker, not a pointer that IS one. */
const POINTER_MAX_TOKENS = 400

/**
 * Compression markers come from their emitters, so pointer detection follows the same
 * protocol as the messages it inspects. The size bound rejects full file contents that
 * merely mention a marker while retaining short recovery pointers.
 */
export function isWireDumpPointer(serialized: string, tokensEst: number): boolean {
  if (tokensEst >= POINTER_MAX_TOKENS) return false
  return isCompressedContent(serialized)
}
