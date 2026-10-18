/**
 * Item text → the chunks the model embeds.
 *
 * Retrieval works on passages, not documents: a long reply about three topics embeds as the
 * average of the three and matches none of them well. So text is cut at paragraph, then
 * sentence, then word boundaries into chunks of at most `maxChars`, each chunk overlapping the
 * previous one by its last sentence so an idea split across a boundary is still whole in one.
 *
 * `MAX_CHUNKS` bounds the cost of a pasted log or a generated file: past it the rest of the
 * item is not embedded (its words stay searchable through full-text search).
 */

export const MAX_CHUNKS = 24
/** Below this a chunk carries too little meaning to be worth a vector. */
const MIN_CHUNK_CHARS = 12

/** Whitespace-normalized text, or '' when nothing in it is a letter or a digit. */
export function embeddableText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return /[\p{L}\p{N}]/u.test(normalized) ? normalized : ''
}

function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n|$)/gu)
  return (parts ?? [paragraph]).map((s) => s.trim()).filter(Boolean)
}

/** Hard-cut a run with no sentence boundary at the last space before `maxChars`. */
function splitLong(sentence: string, maxChars: number): string[] {
  const out: string[] = []
  let rest = sentence
  while (rest.length > maxChars) {
    const space = rest.lastIndexOf(' ', maxChars)
    const cut = space > maxChars / 2 ? space : maxChars
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export function chunkText(text: string, maxChars: number): string[] {
  const whole = embeddableText(text)
  if (!whole) return []
  if (whole.length <= maxChars) return [whole]

  const sentences = text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => splitSentences(paragraph.replace(/[ \t]+/g, ' ')))
    .flatMap((sentence) => splitLong(sentence.replace(/\s+/g, ' '), maxChars))

  const chunks: string[] = []
  let current: string[] = []
  let length = 0
  for (const sentence of sentences) {
    if (length > 0 && length + 1 + sentence.length > maxChars) {
      chunks.push(current.join(' '))
      if (chunks.length >= MAX_CHUNKS) return chunks
      // Carry the last sentence over when it leaves room for the next one.
      const tail = current[current.length - 1]!
      current = tail.length + 1 + sentence.length <= maxChars ? [tail] : []
      length = current.length ? tail.length : 0
    }
    current.push(sentence)
    length += (length > 0 ? 1 : 0) + sentence.length
  }
  if (current.length) chunks.push(current.join(' '))
  return chunks
    .filter((c) => c.length >= MIN_CHUNK_CHARS || chunks.length === 1)
    .slice(0, MAX_CHUNKS)
}
