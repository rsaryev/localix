/**
 * Chunking for the tool-output search index (`tool_output_chunks`). Pure text →
 * sections; no I/O. The goal is BM25-friendly units: a chunk small enough that a
 * hit means "this section answers the query", large enough to carry the answer
 * without a follow-up retrieve.
 *
 * Strategy (in order): split at markdown headings when the output has them
 * (docs, README dumps, `gh` markdown), else at blank-line boundaries (logs, test
 * output, diffs — their natural section separator), then sub-split anything over
 * the byte cap into fixed line groups with a small overlap so a match near a cut
 * still carries its surrounding lines.
 */

export interface OutputChunk {
  /** First line of the section, trimmed — the BM25 title signal (weighted in search). */
  heading: string
  content: string
}

/** Max bytes per chunk — oversized sections dilute BM25 ranking (one giant chunk matches everything). */
export const MAX_CHUNK_BYTES = 4096
/** Lines carried over between forced sub-splits, so a hit at a cut keeps its context. */
const OVERLAP_LINES = 2
/** Hard cap on chunks per output — bounds indexing cost for a pathological result. */
/**
 * Per-output chunk cap. Exported because the tail past it is DROPPED, and a caller that
 * mints an "indexed" pointer has to be able to say the coverage is a prefix.
 */
export const MAX_CHUNKS = 400
const HEADING_RE = /^#{1,6}\s+\S/
const MAX_HEADING_CHARS = 120

const utf8 = new TextEncoder()
const byteLength = (s: string): number => utf8.encode(s).length

function toChunk(lines: string[]): OutputChunk | null {
  const content = lines.join('\n').trim()
  if (!content) return null
  const heading = (lines.find((l) => l.trim().length > 0) ?? '').trim().slice(0, MAX_HEADING_CHARS)
  return { heading, content }
}

/** Sub-split one oversized section into ≤MAX_CHUNK_BYTES line groups with overlap. */
function splitOversized(lines: string[]): OutputChunk[] {
  const out: OutputChunk[] = []
  let group: string[] = []
  let bytes = 0
  for (let i = 0; i < lines.length; i++) {
    const lineBytes = byteLength(lines[i]) + 1
    if (group.length > 0 && bytes + lineBytes > MAX_CHUNK_BYTES) {
      const chunk = toChunk(group)
      if (chunk) out.push(chunk)
      group = group.slice(-OVERLAP_LINES)
      bytes = group.reduce((s, l) => s + byteLength(l) + 1, 0)
    }
    // A single line over the cap gets its own chunk, hard-cut — FTS still indexes
    // its head, and minified one-liners carry no line structure to preserve anyway.
    if (lineBytes > MAX_CHUNK_BYTES) {
      const flushed = toChunk(group)
      if (flushed) out.push(flushed)
      const head = lines[i].slice(0, MAX_CHUNK_BYTES)
      out.push({ heading: head.slice(0, MAX_HEADING_CHARS).trim(), content: head })
      group = []
      bytes = 0
      continue
    }
    group.push(lines[i])
    bytes += lineBytes
  }
  const last = toChunk(group)
  if (last) out.push(last)
  return out
}

/**
 * Split a tool output into search-index chunks. Returns at most {@link MAX_CHUNKS}; the
 * tail past the cap is DROPPED. A bare count does not reveal that — 400 reads the same
 * whether it is the whole output or its first 1.6 MB — so callers must compare against
 * {@link MAX_CHUNKS} and say so where they promise the output is indexed.
 */
export function chunkToolOutput(text: string): OutputChunk[] {
  const lines = text.split('\n')
  const hasHeadings = lines.some((l) => HEADING_RE.test(l))

  // Section boundaries: heading lines when present, else blank lines.
  const sections: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    const isBoundary = hasHeadings ? HEADING_RE.test(line) : line.trim() === ''
    if (isBoundary && current.length > 0) {
      sections.push(current)
      current = hasHeadings ? [line] : []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) sections.push(current)

  const chunks: OutputChunk[] = []
  // Merge small adjacent sections up to the cap so blank-line-heavy output (a log
  // with a gap every 3 lines) doesn't shatter into hundreds of tiny chunks.
  let pending: string[] = []
  let pendingBytes = 0
  const flush = (): void => {
    const chunk = toChunk(pending)
    if (chunk) chunks.push(chunk)
    pending = []
    pendingBytes = 0
  }
  for (const section of sections) {
    const sectionBytes = section.reduce((s, l) => s + byteLength(l) + 1, 0)
    if (sectionBytes > MAX_CHUNK_BYTES) {
      flush()
      chunks.push(...splitOversized(section))
      continue
    }
    if (pendingBytes + sectionBytes > MAX_CHUNK_BYTES) flush()
    pending.push(...section, '')
    pendingBytes += sectionBytes + 1
    if (chunks.length >= MAX_CHUNKS) break
  }
  flush()

  return chunks.slice(0, MAX_CHUNKS)
}
