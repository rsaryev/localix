// How a tool output is stored in `tool_output_artifacts`: the text itself when it is small or does
// not compress, zstd when that is smaller. Read whole and rarely, so the cost is one decompress.

/** Below this a row is cheaper left alone: the saving is a few hundred bytes and a decode per read. */
export const COMPRESS_MIN_BYTES = 4096
/** zstd level 3 is the library default: close to level 9's ratio on text at a fraction of the time. */
const LEVEL = 3
/** Keep the compressed form only when it saves at least a tenth. */
const WORTH_IT = 0.9

const utf8 = new TextEncoder()
const decoder = new TextDecoder()

export type StoredArtifactText =
  | { encoding: 'plain'; content: string; content_z: null; byteLength: number }
  | { encoding: 'zstd'; content: ''; content_z: Uint8Array; byteLength: number }

export function encodeArtifactText(text: string): StoredArtifactText {
  const bytes = utf8.encode(text)
  if (bytes.length >= COMPRESS_MIN_BYTES) {
    const packed = Bun.zstdCompressSync(bytes, { level: LEVEL })
    if (packed.length < bytes.length * WORTH_IT) {
      return { encoding: 'zstd', content: '', content_z: packed, byteLength: bytes.length }
    }
  }
  return { encoding: 'plain', content: text, content_z: null, byteLength: bytes.length }
}

export function decodeArtifactText(row: {
  encoding: 'plain' | 'zstd'
  content: string
  content_z: Uint8Array | null
}): string {
  if (row.encoding !== 'zstd') return row.content
  if (!row.content_z) throw new Error('tool output is marked zstd but has no compressed bytes')
  return decoder.decode(Bun.zstdDecompressSync(row.content_z))
}
