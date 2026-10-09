import { isCompressedContent } from '@localixai/agent'
import { READ_DEDUP_STUB_PHRASE } from '../../../agent-core/tools/file/read-dedup-stub'

/** Above this, a message is content that MENTIONS a marker, not a pointer that IS one. */
const POINTER_MAX_TOKENS = 400

/**
 * Compression and read dedup markers come from their emitters, so pointer detection
 * follows the same protocol as the messages it inspects. The size bound rejects full
 * file contents that merely mention a marker while retaining short recovery pointers.
 */
export function isWireDumpPointer(serialized: string, tokensEst: number): boolean {
  if (tokensEst >= POINTER_MAX_TOKENS) return false
  return isCompressedContent(serialized) || serialized.includes(READ_DEDUP_STUB_PHRASE)
}
