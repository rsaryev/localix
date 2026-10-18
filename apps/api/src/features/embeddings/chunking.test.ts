import { describe, expect, test } from 'bun:test'
import { chunkText, embeddableText, MAX_CHUNKS } from './chunking'

describe('chunkText', () => {
  test('short text is one whitespace-normalized chunk', () => {
    expect(chunkText('  hello \n\n world ', 100)).toEqual(['hello world'])
  })

  test('text without letters or digits is not embedded', () => {
    expect(chunkText('--- *** ...', 100)).toEqual([])
    expect(embeddableText('```\n\n```')).toBe('')
  })

  test('long text splits at sentences under the cap and overlaps by one sentence', () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i} talks about topic ${i}.`,
    )
    const chunks = chunkText(sentences.join(' '), 200)
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200)
    const lastOfFirst = chunks[0]!.split('. ').pop()!
    expect(chunks[1]!.startsWith(lastOfFirst.replace(/\.$/, ''))).toBe(true)
  })

  test('a run without boundaries is cut at words, never past the cap', () => {
    const chunks = chunkText(Array.from({ length: 400 }, (_, i) => `w${i}`).join(' '), 120)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120)
  })

  test('a pasted log stops at MAX_CHUNKS', () => {
    const log = Array.from({ length: 5000 }, (_, i) => `line ${i} failed.`).join('\n')
    expect(chunkText(log, 100).length).toBe(MAX_CHUNKS)
  })
})
