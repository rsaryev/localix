import { expect, test } from 'bun:test'
import { parseReaderBytes } from './library'

const bytes = (source: string) => new TextEncoder().encode(source)

test('truncated Markdown retains the word count of the complete chapter', async () => {
  const parsed = await parseReaderBytes('book.md', bytes('word '.repeat(100_001)))
  expect(parsed.chapters).toHaveLength(1)
  expect(parsed.chapters[0]!.text).toEndWith('… [chapter truncated]')
  expect(parsed.chapters[0]!.content).toEndWith('… [chapter truncated]')
  expect(parsed.chapters[0]!.wordCount).toBe(100_001)
  expect(parsed.document.wordCount).toBe(100_001)
})

test('an empty document still has a readable placeholder chapter', async () => {
  const parsed = await parseReaderBytes('empty_book.md', bytes(''))
  expect(parsed.document.title).toBe('empty book')
  expect(parsed.chapters).toHaveLength(1)
  expect(parsed.chapters[0]).toMatchObject({
    index: 0,
    kind: 'text',
    text: 'No readable text was found.',
  })
})

test('the document and its navigation share the bounded chapter count', async () => {
  const source = Array.from({ length: 401 }, (_, i) => `## Chapter ${i + 1}\n\nWord.\n`).join('\n')
  const parsed = await parseReaderBytes('chapters.md', bytes(source))
  expect(parsed.chapters).toHaveLength(400)
  expect(parsed.document.chapters).toHaveLength(400)
  expect(parsed.chapters.at(-1)).toMatchObject({ index: 399, title: 'Chapter 400' })
  expect(parsed.document.chapters.at(-1)).toMatchObject({ index: 399, title: 'Chapter 400' })
})
