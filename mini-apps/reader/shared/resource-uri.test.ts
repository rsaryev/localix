import { describe, expect, test } from 'bun:test'
import { resourceNav } from '@localixai/mini-app-sdk/backend'

import { parseReaderUri, readerBookUri, readerChapterUri, readerRootUri } from './resource-uri'

describe('reader resource URI', () => {
  test('round-trips paths without turning them into URI structure', () => {
    const path = 'notes/Deep Work & focus.epub'
    expect(parseReaderUri(readerBookUri(path))).toEqual({ kind: 'book', source: { path } })
    expect(parseReaderUri(readerChapterUri(path, 3))).toEqual({
      kind: 'chapter',
      source: { path },
      chapter: 3,
    })
  })

  test('is natively drillable as Reader → book → chapter', () => {
    const source = { path: '/Users/dev/Books/Deep Work.epub' }
    const book = readerBookUri(source)
    const chapter = readerChapterUri(source, 3)
    expect(book).not.toContain('?')
    expect(resourceNav(`${book}/`)).toMatchObject({ parent: book, segment: '', provider: 'reader' })
    expect(resourceNav(chapter)).toMatchObject({ parent: book, segment: '3', provider: 'reader' })
  })

  test('round-trips uploaded media identities', () => {
    const source = { mediaId: 'abc123.epub', name: 'Agentic Mesh.epub' }
    expect(parseReaderUri(readerChapterUri(source, 2))).toEqual({
      kind: 'chapter',
      source,
      chapter: 2,
    })
  })

  test('keeps the provider root addressable', () => {
    expect(parseReaderUri(readerRootUri())).toEqual({ kind: 'root' })
  })

  test('rejects malformed chapter positions', () => {
    expect(parseReaderUri(`${readerRootUri()}/chapter?path=a.epub&chapter=-1`)).toBeNull()
    expect(parseReaderUri(`${readerRootUri()}/chapter?path=a.epub&chapter=nope`)).toBeNull()
  })

  test('query-based links are not Reader resources', () => {
    expect(parseReaderUri(`${readerRootUri()}/chapter?path=book.epub&chapter=2`)).toBeNull()
  })
})
