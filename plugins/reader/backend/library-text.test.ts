import { expect, test } from 'bun:test'
import { parseReaderBytes } from './library'

const bytes = (source: string) => new TextEncoder().encode(source)

test('plain text normalizes CRLF and recognizes English and Russian chapter headings', async () => {
  const parsed = await parseReaderBytes(
    'field_notes.txt',
    bytes(
      'Introduction.\r\n\r\nChapter I: Start\r\nFirst part.\r\n\r\nГлава 2 — Далее\r\nВторая часть.',
    ),
  )
  expect(parsed.chapters.map((item) => item.title)).toEqual([
    'field notes',
    'Chapter I: Start',
    'Глава 2 — Далее',
  ])
  expect(parsed.chapters.map((item) => item.text)).toEqual([
    'Introduction.',
    'First part.',
    'Вторая часть.',
  ])
})

test('unstructured plain text splits only above the length threshold without losing content', async () => {
  const atLimit = await parseReaderBytes('book.txt', bytes('a'.repeat(45_000)))
  expect(atLimit.chapters).toHaveLength(1)
  const source = 'a'.repeat(45_001)
  const overLimit = await parseReaderBytes('book.txt', bytes(source))
  expect(overLimit.chapters.map((item) => item.title)).toEqual(['Part 1', 'Part 2'])
  expect(overLimit.chapters.map((item) => item.text.length)).toEqual([28_000, 17_001])
  expect(overLimit.chapters.map((item) => item.text).join('')).toBe(source)
})
